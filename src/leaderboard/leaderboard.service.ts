import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cron } from '@nestjs/schedule';
import type { Cache } from 'cache-manager';
import { PostgrestError } from '@supabase/supabase-js';
import { SupabaseService } from 'src/supabase/supabase.service';
import { longestStreak } from './leaderboard.streak';
import {
  CATEGORIES,
  emptyWinCounts,
  LeaderboardCategory,
  pickWinners,
  Win,
  WinCounts,
} from './leaderboard.awards';

export interface LeaderboardEntry {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  /**
   * Always null: this schema has no athlete avatar (`avatar_url` belongs to
   * `coach_profile`). The field stays because the client already reads it and
   * falls back to initials, so it costs nothing and the day a photo exists
   * only this line changes.
   */
  avatarUrl: string | null;
  /** Completed workouts dated inside the month. */
  workouts: number;
  /** Longest run of consecutive days with a completed workout. */
  workoutStreak: number;
  /** Longest run of consecutive days with at least one meal logged. */
  foodStreak: number;
  /**
   * Boards won in closed months, per category — what the row shows beside a
   * name. Career-wide, not wins in this group: somebody who changed coaches
   * keeps their record.
   */
  wins: WinCounts;
}

/** One permanent badge, for the profile. */
export interface Badge {
  month: string;
  category: LeaderboardCategory;
  /** The winning number: 21 workouts, a 12-day streak. */
  value: number;
}

/** A scored month before the permanent record is attached to it. */
type ScoredRow = Omit<LeaderboardEntry, 'wins'>;

export interface MonthlyLeaderboard {
  month: string;
  coachId: string | null;
  entries: LeaderboardEntry[];
}

interface RosterMember {
  userId: string;
  firstName: string | null;
  lastName: string | null;
}

/** The embedded `user` join, which PostgREST types as a list. */
interface NameRow {
  first_name: string | null;
  last_name: string | null;
}

interface ProgramOwnerRow {
  user_id: string;
}

/** The scored board is identical for everyone in the group. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** PostgREST's own ceiling; the loop below copes with a lower project cap. */
const PAGE_SIZE = 1000;

/**
 * The first month anyone can win.
 *
 * September 2026 was already half over when badges shipped, and a permanent
 * award for a contest nobody knew they were in is not much of an award. Closed
 * months before this are never scored, so the first badges land on 1 Nov 2026.
 */
const FIRST_SCORED_MONTH = '2026-10';

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * The monthly competition inside one coach's group.
 *
 * Three boards off one payload — most completed workouts, longest workout
 * streak, longest food-logging streak — because the client sorts them itself
 * and coach and athlete then share a single response.
 */
@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  private get supabase() {
    return this.supabaseService.getClient();
  }

  async getMonthlyLeaderboard(
    callerId: string,
    month: string,
  ): Promise<MonthlyLeaderboard> {
    const coachId = await this.resolveCoachId(callerId);
    // An athlete with no coach, not an error: they simply have no group yet.
    if (!coachId) return { month, coachId: null, entries: [] };

    // Keyed by the group, not by the caller: one computation then serves every
    // athlete in the gym plus their coach.
    //
    // The `v2` is the payload's shape, and it is what makes a deploy that
    // changes that shape safe: without it, warm keys keep serving the old
    // entries for the rest of their five minutes, and a client reading a field
    // that was just added finds it missing. Bump it whenever an entry gains or
    // loses a field.
    const cacheKey = `leaderboard:monthly:v2:${coachId}:${month}`;
    const cached = await this.cacheManager.get<LeaderboardEntry[]>(cacheKey);
    if (cached) return { month, coachId, entries: cached };

    const roster = (await this.approvedRosters(coachId)).get(coachId) ?? [];
    if (roster.length === 0) return { month, coachId, entries: [] };

    const scored = await this.scoreMonth(roster, month);
    const wins = await this.fetchWinCounts(roster.map((m) => m.userId));
    const entries = scored.map((entry) => ({
      ...entry,
      wins: wins.get(entry.userId) ?? emptyWinCounts(),
    }));

    await this.cacheManager.set(cacheKey, entries, CACHE_TTL_MS);

    return { month, coachId, entries };
  }

  /** Every badge one athlete has won, newest month first. */
  async getBadges(userId: string): Promise<Badge[]> {
    const { data, error } = await this.supabase
      .from('leaderboard_wins')
      .select('month, category, value')
      .eq('user_id', userId)
      .order('month', { ascending: false });

    if (error) {
      throw new Error(`Error fetching badges: ${error.message}`);
    }

    return (data ?? []) as Badge[];
  }

  /**
   * The group the caller competes in, resolved from the token alone.
   *
   * A coach scores their own roster; anyone else scores the roster of the coach
   * who trains them. Nothing in the request names a group, so no caller can ask
   * for one they are not in.
   */
  private async resolveCoachId(callerId: string): Promise<string | null> {
    const { data: profile, error: profileError } = await this.supabase
      .from('user')
      .select('role')
      .eq('id', callerId)
      .maybeSingle();

    if (profileError) {
      throw new Error(`Error fetching caller: ${profileError.message}`);
    }

    if (profile?.role === 'coach') return callerId;

    const { data, error } = await this.supabase
      .from('coach_user_relations')
      .select('coach_id')
      .eq('user_id', callerId)
      .eq('status', 'approved')
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Error fetching coach relation: ${error.message}`);
    }

    return (data?.coach_id as string | undefined) ?? null;
  }

  /**
   * Approved athletes by coach — one group when a coach is named, every group
   * when one is not. The award job needs all of them; a request needs one.
   *
   * The coach is never in their own roster: they do not compete against the
   * people they train.
   */
  private async approvedRosters(
    coachId?: string,
  ): Promise<Map<string, RosterMember[]>> {
    let query = this.supabase
      .from('coach_user_relations')
      .select(
        'coach_id, user_id, user:coach_user_relations_user_id_fkey ( first_name, last_name )',
      )
      .eq('status', 'approved');

    if (coachId) query = query.eq('coach_id', coachId);

    const { data, error } = await query;

    if (error) {
      throw new Error(`Error fetching coach roster: ${error.message}`);
    }

    const rosters = new Map<string, RosterMember[]>();

    for (const row of data ?? []) {
      if (!row.coach_id || !row.user_id) continue;

      const user = one(row.user as NameRow | NameRow[] | null);
      const roster = rosters.get(row.coach_id as string) ?? [];
      roster.push({
        userId: row.user_id as string,
        firstName: user?.first_name ?? null,
        lastName: user?.last_name ?? null,
      });
      rosters.set(row.coach_id as string, roster);
    }

    return rosters;
  }

  private async scoreMonth(
    roster: RosterMember[],
    month: string,
  ): Promise<ScoredRow[]> {
    const { start, end } = this.monthRange(month);
    const userIds = roster.map((member) => member.userId);

    const [workoutLogs, meals] = await Promise.all([
      this.fetchAll<{
        workout_date: string;
        user_workout_programs: ProgramOwnerRow | ProgramOwnerRow[] | null;
      }>('workout logs', (from, to) =>
        this.supabase
          .from('workout_logs')
          .select('workout_date, user_workout_programs!inner ( user_id )')
          .in('user_workout_programs.user_id', userIds)
          .eq('completed', true)
          .gte('workout_date', start)
          .lt('workout_date', end)
          .order('id')
          .range(from, to),
      ),

      this.fetchAll<{ user_id: string; meal_time: string }>(
        'meals',
        (from, to) =>
          this.supabase
            .from('meals')
            .select('user_id, meal_time')
            .in('user_id', userIds)
            // Day boundaries are UTC here, as they are in every other meal
            // query in this repo.
            .gte('meal_time', `${start} 00:00:00+00`)
            .lt('meal_time', `${end} 00:00:00+00`)
            .order('id')
            .range(from, to),
      ),
    ]);

    // Count and days are tracked apart on purpose: two sessions in one day are
    // two workouts but a single day of a streak.
    const workoutCount = new Map<string, number>();
    const workoutDays = new Map<string, Set<string>>();

    for (const row of workoutLogs) {
      const userId = one(row.user_workout_programs)?.user_id;
      if (!userId) continue;

      workoutCount.set(userId, (workoutCount.get(userId) ?? 0) + 1);

      const days = workoutDays.get(userId) ?? new Set<string>();
      days.add(String(row.workout_date).slice(0, 10));
      workoutDays.set(userId, days);
    }

    const mealDays = new Map<string, Set<string>>();
    for (const row of meals) {
      const days = mealDays.get(row.user_id) ?? new Set<string>();
      days.add(String(row.meal_time).slice(0, 10));
      mealDays.set(row.user_id, days);
    }

    // The roster drives the result, not the logs: an athlete who did nothing
    // this month is still a participant, and seeing themselves last is rather
    // the point of a competition.
    return roster.map((member) => ({
      userId: member.userId,
      firstName: member.firstName,
      lastName: member.lastName,
      avatarUrl: null,
      workouts: workoutCount.get(member.userId) ?? 0,
      workoutStreak: longestStreak(workoutDays.get(member.userId) ?? []),
      foodStreak: longestStreak(mealDays.get(member.userId) ?? []),
    }));
  }

  /**
   * Reads every matching row, a page at a time.
   *
   * PostgREST caps a response at the project's max-rows, and a truncation here
   * would not look like an error — it would look like a shorter streak. A dozen
   * clients logging three meals a day pass the default 1000 inside one month,
   * which is an ordinary gym, not an edge case. Pages advance by what came back
   * rather than by the requested size, so a lower project cap still pages
   * correctly; the price is one empty request at the end.
   */
  private async fetchAll<T>(
    label: string,
    page: (
      from: number,
      to: number,
    ) => PromiseLike<{ data: unknown[] | null; error: PostgrestError | null }>,
  ): Promise<T[]> {
    const rows: T[] = [];

    for (let from = 0; ; ) {
      const { data, error } = await page(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`Error fetching ${label}: ${error.message}`);

      const batch = (data ?? []) as T[];
      if (batch.length === 0) break;

      rows.push(...batch);
      from += batch.length;
    }

    return rows;
  }

  /** Career badge counts for a set of athletes, in one read. */
  private async fetchWinCounts(
    userIds: string[],
  ): Promise<Map<string, WinCounts>> {
    const rows = await this.fetchAll<{
      user_id: string;
      category: LeaderboardCategory;
    }>('leaderboard wins', (from, to) =>
      this.supabase
        .from('leaderboard_wins')
        .select('user_id, category')
        .in('user_id', userIds)
        .order('id')
        .range(from, to),
    );

    const counts = new Map<string, WinCounts>();

    for (const row of rows) {
      const entry = counts.get(row.user_id) ?? emptyWinCounts();
      // A category check exists in the database, but a row written before a
      // category was renamed would still land here; ignore what we cannot show.
      if (!CATEGORIES.includes(row.category)) continue;
      entry[row.category] += 1;
      counts.set(row.user_id, entry);
    }

    return counts;
  }

  /**
   * Awards last month's badges, once it is closed.
   *
   * Daily rather than monthly on purpose. A month-boundary job that runs once
   * and happens to fall in a deploy or an outage would lose that month for
   * good, and a competition nobody was awarded for is worse than one that is a
   * day late. Groups already holding rows for the month are skipped, so the
   * normal run is a single query and the retry after a half-finished run picks
   * up exactly the groups that were missed.
   */
  @Cron('10 3 * * *')
  async awardClosedMonth(): Promise<void> {
    try {
      const month = this.previousMonthOf(new Date().toISOString().slice(0, 7));
      if (month < FIRST_SCORED_MONTH) return;

      const { data: awarded, error } = await this.supabase
        .from('leaderboard_wins')
        .select('coach_id')
        .eq('month', month);

      if (error) {
        throw new Error(`Error reading awarded months: ${error.message}`);
      }

      const done = new Set(
        (awarded ?? []).map((row) => row.coach_id as string),
      );
      const rosters = await this.approvedRosters();

      for (const [coachId, roster] of rosters) {
        // Nothing to settle: already awarded, or never a contest.
        if (done.has(coachId) || roster.length < 2) continue;

        const scored = await this.scoreMonth(roster, month);
        const wins = pickWinners(scored);
        if (wins.length === 0) continue;

        await this.storeWins(coachId, month, wins);
        this.logger.log(
          `Awarded ${wins.length} badge(s) for ${month} in group ${coachId}.`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Awarding monthly badges failed: ${message}`);
    }
  }

  private async storeWins(
    coachId: string,
    month: string,
    wins: Win[],
  ): Promise<void> {
    const { error } = await this.supabase.from('leaderboard_wins').upsert(
      wins.map((win) => ({
        coach_id: coachId,
        user_id: win.userId,
        month,
        category: win.category,
        value: win.value,
      })),
      // The unique index is what makes a re-run harmless; `ignoreDuplicates`
      // is what stops it being an error rather than a no-op.
      { onConflict: 'coach_id,month,category,user_id', ignoreDuplicates: true },
    );

    if (error) {
      throw new Error(`Error storing leaderboard wins: ${error.message}`);
    }
  }

  private previousMonthOf(month: string): string {
    const [year, monthNum] = month.split('-').map(Number);
    return new Date(Date.UTC(year, monthNum - 2, 1)).toISOString().slice(0, 7);
  }

  private monthRange(month: string) {
    const [year, monthNum] = month.split('-').map(Number);
    return {
      start: `${month}-01`,
      // First day of the next month, exclusive.
      end: new Date(Date.UTC(year, monthNum, 1)).toISOString().slice(0, 10),
    };
  }
}
