import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PostgrestError } from '@supabase/supabase-js';
import { SupabaseService } from 'src/supabase/supabase.service';
import { drawWinners, Entrant } from './rewards.draw';
import { countEntry, Entry, MIN_WORKOUT_DAYS } from './rewards.tickets';

/** What a settled month gave one athlete. */
export interface BoxSummary {
  month: string;
  tickets: number;
  workoutDays: number;
  opened: boolean;
  /**
   * Null until the box is opened, and null after it if the month was a blank.
   * An unopened box never carries its prize: the result exists on the server
   * long before the athlete taps it, and sending it early would let anyone
   * with the network tab spoil their own surprise — or worse, read a code
   * out of a box they never opened.
   */
  prize: { label: string; imageUrl: string | null; code: string } | null;
}

/** The draw as one athlete sees it. */
export interface MonthlyDraw {
  /** The month being played right now. */
  month: string;
  workoutDays: number;
  tickets: number;
  qualified: boolean;
  /** The bar, sent so the copy has one source. */
  minWorkoutDays: number;
  /** Prizes stocked for this month. Zero means nothing to win yet. */
  prizes: number;
  /** Settled months, newest first. At most a year of them. */
  boxes: BoxSummary[];
}

interface CodeRow {
  id: string;
  label: string;
  image_url: string | null;
  code: string;
}

interface BoxRow {
  month: string;
  tickets: number;
  workout_days: number;
  opened_at: string | null;
  prize_codes: CodeRow | CodeRow[] | null;
}

/** PostgREST's own ceiling; the loop below copes with a lower project cap. */
const PAGE_SIZE = 1000;

/** Boxes kept in front of an athlete. Older ones are settled history. */
const BOX_HISTORY = 12;

/**
 * The first month that can be drawn.
 *
 * September 2026 was half over when this shipped, and a draw nobody knew they
 * were in is not a draw. Closed months before this are never settled.
 */
const FIRST_DRAWN_MONTH = '2026-10';

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * The monthly draw.
 *
 * Train regularly and the month becomes tickets; when the month closes a job
 * deals the prizes that were stocked for it among everyone who qualified. One
 * pool for the whole app, not one per coach: a group of three would otherwise
 * be a much better place to be lucky in than a group of thirty.
 *
 * Nothing about a prize is decided on the phone. The box is opened long after
 * the result was written down.
 */
@Injectable()
export class RewardsService {
  private readonly logger = new Logger(RewardsService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  private get supabase() {
    return this.supabaseService.getClient();
  }

  /** This month's standing, plus whatever settled months are still to open. */
  async getMonthlyDraw(callerId: string): Promise<MonthlyDraw> {
    const month = new Date().toISOString().slice(0, 7);

    const [entry, prizes, boxes] = await Promise.all([
      this.entryFor(callerId, month),
      this.countPrizes(month),
      this.boxesFor(callerId),
    ]);

    return {
      month,
      workoutDays: entry.workoutDays,
      tickets: entry.tickets,
      qualified: entry.qualified,
      minWorkoutDays: MIN_WORKOUT_DAYS,
      prizes,
      boxes,
    };
  }

  /**
   * Opens one settled box.
   *
   * All this does is record that it was opened and hand back what was already
   * in it. Opening twice is not an error — a phone that loses the response
   * would otherwise have destroyed the only sight of the prize — it simply
   * returns the same contents again.
   */
  async openBox(callerId: string, month: string): Promise<BoxSummary> {
    const { data, error } = await this.supabase
      .from('monthly_boxes')
      .select(
        'month, tickets, workout_days, opened_at, prize_codes ( id, label, image_url, code )',
      )
      .eq('user_id', callerId)
      .eq('month', month)
      .maybeSingle();

    if (error) throw new Error(`Error fetching box: ${error.message}`);
    if (!data) throw new NotFoundException('No box for that month.');

    const row = data as BoxRow;

    if (!row.opened_at) {
      const { error: openError } = await this.supabase
        .from('monthly_boxes')
        .update({ opened_at: new Date().toISOString() })
        .eq('user_id', callerId)
        .eq('month', month)
        .is('opened_at', null);

      if (openError) {
        throw new Error(`Error opening box: ${openError.message}`);
      }
    }

    return this.toSummary(row, true);
  }

  /**
   * Deals last month's prizes, once it is closed.
   *
   * Daily rather than monthly, and for the same reasons the badge job is: a
   * once-a-month job that lands in a deploy loses the month for good. Two extra
   * properties keep the retry honest:
   *
   *  - **A month already in `monthly_draws` is skipped.** The normal run is one
   *    query.
   *  - **The seed is the month.** Every input is frozen once the month closes,
   *    the pool included, so a half-finished run deals exactly the same winners
   *    on its next attempt. Nobody can lose a prize to a crash and nobody can
   *    win one twice.
   *
   * A month nobody stocked prizes for is left unsettled rather than settled
   * empty, so codes loaded late still get dealt on the next night's run.
   */
  @Cron('20 3 * * *')
  async drawClosedMonth(): Promise<void> {
    try {
      const month = this.previousMonth();
      if (month < FIRST_DRAWN_MONTH) return;

      const { data: drawn, error: drawnError } = await this.supabase
        .from('monthly_draws')
        .select('month')
        .eq('month', month)
        .maybeSingle();

      if (drawnError) {
        throw new Error(`Error reading draws: ${drawnError.message}`);
      }
      if (drawn) return;

      // Every code stocked for the month, awarded or not. Filtering to the
      // unawarded ones would make the pool shrink between attempts, and with it
      // the winners a retry deals.
      const { data: codeRows, error: codesError } = await this.supabase
        .from('prize_codes')
        .select('id')
        .eq('month', month)
        .order('id');

      if (codesError) {
        throw new Error(`Error reading prize pool: ${codesError.message}`);
      }

      const codes = (codeRows ?? []).map((row) => row.id as string);
      if (codes.length === 0) {
        this.logger.log(`No prizes stocked for ${month}; not drawing yet.`);
        return;
      }

      const entries = await this.scoreMonth(month);
      const entrants: Entrant[] = [...entries.entries()]
        .filter(([, entry]) => entry.qualified)
        .map(([userId, entry]) => ({ userId, tickets: entry.tickets }));

      const seed = `draw:${month}`;
      const winners = drawWinners(entrants, codes.length, seed);
      const prizeOf = new Map(
        winners.map((userId, index) => [userId, codes[index]]),
      );

      if (entrants.length > 0) {
        const { error: boxError } = await this.supabase
          .from('monthly_boxes')
          .upsert(
            entrants.map((entrant) => ({
              user_id: entrant.userId,
              month,
              tickets: entrant.tickets,
              workout_days: entries.get(entrant.userId)?.workoutDays ?? 0,
              prize_code_id: prizeOf.get(entrant.userId) ?? null,
            })),
            { onConflict: 'user_id,month', ignoreDuplicates: true },
          );

        if (boxError) {
          throw new Error(`Error writing boxes: ${boxError.message}`);
        }

        const spent = [...prizeOf.values()];
        if (spent.length > 0) {
          const { error: spendError } = await this.supabase
            .from('prize_codes')
            .update({ awarded_at: new Date().toISOString() })
            .in('id', spent)
            .is('awarded_at', null);

          if (spendError) {
            throw new Error(`Error marking codes: ${spendError.message}`);
          }
        }
      }

      const { error: recordError } = await this.supabase
        .from('monthly_draws')
        .insert({
          month,
          seed,
          entrants: entrants.length,
          prizes: winners.length,
        });

      if (recordError) {
        throw new Error(`Error recording the draw: ${recordError.message}`);
      }

      this.logger.log(
        `Drew ${winners.length} prize(s) for ${month} among ${entrants.length} entrant(s).`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Drawing the monthly prizes failed: ${message}`);
    }
  }

  /** One athlete's month, for the card that shows their progress. */
  private async entryFor(userId: string, month: string): Promise<Entry> {
    const { start, end } = this.monthRange(month);

    const [workoutLogs, meals] = await Promise.all([
      this.fetchAll<{ workout_date: string }>('workout logs', (from, to) =>
        this.supabase
          .from('workout_logs')
          .select('workout_date, user_workout_programs!inner ( user_id )')
          .eq('user_workout_programs.user_id', userId)
          .eq('completed', true)
          .gte('workout_date', start)
          .lt('workout_date', end)
          .order('id')
          .range(from, to),
      ),

      this.fetchAll<{ meal_time: string }>('meals', (from, to) =>
        this.supabase
          .from('meals')
          .select('meal_time')
          .eq('user_id', userId)
          // Day boundaries are UTC here, as they are in every other meal query
          // in this repo.
          .gte('meal_time', `${start} 00:00:00+00`)
          .lt('meal_time', `${end} 00:00:00+00`)
          .order('id')
          .range(from, to),
      ),
    ]);

    return countEntry(
      workoutLogs.map((row) => String(row.workout_date).slice(0, 10)),
      meals.map((row) => String(row.meal_time).slice(0, 10)),
    );
  }

  /**
   * Everybody's month, for the draw.
   *
   * A whole-month scan of both tables rather than a roster's slice, because the
   * pool is the whole app. It runs once a month at three in the morning, which
   * is what buys the simplicity; the day that stops being cheap, narrow the
   * meal query to the users who already cleared the workout bar.
   */
  private async scoreMonth(month: string): Promise<Map<string, Entry>> {
    const { start, end } = this.monthRange(month);

    const [workoutLogs, meals] = await Promise.all([
      this.fetchAll<{
        workout_date: string;
        user_workout_programs:
          | { user_id: string }
          | { user_id: string }[]
          | null;
      }>('workout logs', (from, to) =>
        this.supabase
          .from('workout_logs')
          .select('workout_date, user_workout_programs!inner ( user_id )')
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
            .gte('meal_time', `${start} 00:00:00+00`)
            .lt('meal_time', `${end} 00:00:00+00`)
            .order('id')
            .range(from, to),
      ),
    ]);

    const workoutDays = new Map<string, Set<string>>();
    for (const row of workoutLogs) {
      const userId = one(row.user_workout_programs)?.user_id;
      if (!userId) continue;

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

    // Only people who trained can be in the draw, so they are the only ones
    // worth counting: somebody who logged nothing but lunches is not an entry.
    const entries = new Map<string, Entry>();
    for (const [userId, days] of workoutDays) {
      entries.set(userId, countEntry(days, mealDays.get(userId) ?? []));
    }

    return entries;
  }

  private async countPrizes(month: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('prize_codes')
      .select('id', { count: 'exact', head: true })
      .eq('month', month);

    if (error) throw new Error(`Error counting prizes: ${error.message}`);
    return count ?? 0;
  }

  private async boxesFor(userId: string): Promise<BoxSummary[]> {
    const { data, error } = await this.supabase
      .from('monthly_boxes')
      .select(
        'month, tickets, workout_days, opened_at, prize_codes ( id, label, image_url, code )',
      )
      .eq('user_id', userId)
      .order('month', { ascending: false })
      .limit(BOX_HISTORY);

    if (error) throw new Error(`Error fetching boxes: ${error.message}`);

    return (data ?? []).map((row) => this.toSummary(row as BoxRow, false));
  }

  private toSummary(row: BoxRow, justOpened: boolean): BoxSummary {
    const opened = justOpened || row.opened_at !== null;
    const code = one(row.prize_codes);

    return {
      month: row.month,
      tickets: row.tickets,
      workoutDays: row.workout_days,
      opened,
      prize:
        opened && code
          ? { label: code.label, imageUrl: code.image_url, code: code.code }
          : null,
    };
  }

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

  private previousMonth(): string {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
      .toISOString()
      .slice(0, 7);
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
