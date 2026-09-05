import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GoogleGenAI, Type } from '@google/genai';
import { createHash } from 'crypto';
import { SupabaseService } from 'src/supabase/supabase.service';
import { AccessService } from 'src/auth/access.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import {
  dismissalSurvives,
  HALF_WINDOW_DAYS,
  RetentionBand,
  RetentionFactor,
  RetentionSignals,
  scoreClient,
  WINDOW_DAYS,
} from './retention.scoring';

// One import site for the whole feature: the controller and the DTOs should
// not have to know which half of it a type lives in.
export type {
  RetentionBand,
  RetentionFactor,
  RetentionSignals,
} from './retention.scoring';
export { dismissalSurvives, scoreClient } from './retention.scoring';

/** The part a model writes. Never a number the score depends on. */
export interface RetentionNote {
  headline: string;
  why: string;
  suggestedAction: string;
  draftMessage: string;
}

export interface RetentionEntry {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  score: number | null;
  band: RetentionBand;
  factors: RetentionFactor[];
  note: RetentionNote | null;
  computedAt: string | null;
  /** The coach closed this card and has not been shown it since. */
  dismissed: boolean;
}

export interface RetentionDetail extends RetentionEntry {
  signals: RetentionSignals | null;
}

/** The embedded `user` join, which PostgREST types as a list. */
interface NameRow {
  first_name: string | null;
  last_name: string | null;
}

interface Pair {
  coachId: string;
  clientId: string;
  firstName: string | null;
  lastName: string | null;
}

interface StoredRow {
  coach_id: string;
  user_id: string;
  inputs_hash: string | null;
  note: RetentionNote | null;
  model: string | null;
  notified_band: string | null;
  notified_at: string | null;
  dismissed_at: string | null;
  dismissed_band: string | null;
}

const GEMINI_MODEL = 'gemini-3-flash-preview';

/**
 * Ceiling on generated notes per run.
 *
 * The job walks every coach's whole roster; a bug in the scoring — or one very
 * bad week across a big gym — must not turn into an unbounded number of paid
 * calls before anyone sees the bill. Anything past the cap keeps its score and
 * its factors and simply has no note this morning.
 */
const MAX_NOTES_PER_RUN = 60;

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * The body of the one push a coach gets, however many clients crossed at once.
 *
 * Czech counts the way Czech counts: two to four take a different form from
 * five and up, and the verb after them changes too. "3 klientů přestalo" is
 * broken Czech, and two or three is exactly the range this lands in most
 * mornings. At most three names are listed — past that the number is the
 * message and the list is just a wall to open the app for.
 */
function droppedOffBody(names: string[]): string {
  if (names.length === 1) {
    return `${names[0]} přestal(a) trénovat podle plánu. Ozvi se dřív, než to vzdá.`;
  }

  const listed = names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : '');
  const subject =
    names.length < 5
      ? `${names.length} klienti přestali`
      : `${names.length} klientů přestalo`;

  return `${subject} trénovat podle plánu: ${listed}`;
}

/**
 * Drop-off risk for a coach's clients.
 *
 * Two layers, deliberately separated. The score is arithmetic over dates that
 * are already in the database — reproducible, arguable, and cheap enough to run
 * for everyone every morning. The model never sees it as a question: it is
 * handed the finished numbers and writes the reading of them plus the message
 * the coach can actually send. A model that guessed the number would be a model
 * deciding who gets chased, off data it cannot count.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);
  private genAI: GoogleGenAI;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly accessService: AccessService,
    private readonly notificationsService: NotificationsService,
  ) {
    this.genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  private get supabase() {
    return this.supabaseService.supabase;
  }

  // ── read side ──────────────────────────────────────────────────────────────

  /**
   * The coach's roster, worst first. A plain read of what the job last wrote —
   * opening the dashboard never triggers scoring or a paid call.
   */
  async listForCoach(coachId: string): Promise<RetentionEntry[]> {
    const { data, error } = await this.supabase
      .from('client_retention')
      .select(
        `
        user_id,
        score,
        band,
        factors,
        note,
        computed_at,
        dismissed_at,
        user:client_retention_user_id_fkey ( first_name, last_name )
      `,
      )
      .eq('coach_id', coachId)
      .order('score', { ascending: false, nullsFirst: false });

    if (error) {
      throw new Error(`Error fetching retention list: ${error.message}`);
    }

    return (data ?? []).map((row) => {
      const user = one(row.user as NameRow | NameRow[] | null);
      return {
        userId: row.user_id as string,
        firstName: user?.first_name ?? null,
        lastName: user?.last_name ?? null,
        score: (row.score as number | null) ?? null,
        band: row.band as RetentionBand,
        factors: (row.factors as RetentionFactor[]) ?? [],
        note: (row.note as RetentionNote | null) ?? null,
        computedAt: (row.computed_at as string | null) ?? null,
        dismissed: row.dismissed_at !== null,
      };
    });
  }

  /** One client, with the signal vector behind the score. Coach only. */
  async getForClient(
    coachId: string,
    clientId: string,
  ): Promise<RetentionDetail | null> {
    if (!(await this.accessService.isCoachOf(coachId, clientId))) {
      throw new ForbiddenException('This is not your client.');
    }

    const { data, error } = await this.supabase
      .from('client_retention')
      .select(
        `
        user_id,
        score,
        band,
        factors,
        signals,
        note,
        computed_at,
        dismissed_at,
        user:client_retention_user_id_fkey ( first_name, last_name )
      `,
      )
      .eq('coach_id', coachId)
      .eq('user_id', clientId)
      .maybeSingle();

    if (error) {
      throw new Error(`Error fetching retention detail: ${error.message}`);
    }
    if (!data) return null;

    const user = one(data.user as NameRow | NameRow[] | null);

    return {
      userId: data.user_id as string,
      firstName: user?.first_name ?? null,
      lastName: user?.last_name ?? null,
      score: (data.score as number | null) ?? null,
      band: data.band as RetentionBand,
      factors: (data.factors as RetentionFactor[]) ?? [],
      signals: (data.signals as RetentionSignals) ?? null,
      note: (data.note as RetentionNote | null) ?? null,
      computedAt: (data.computed_at as string | null) ?? null,
      dismissed: data.dismissed_at !== null,
    };
  }

  // ── write side ─────────────────────────────────────────────────────────────

  /**
   * Close one card.
   *
   * Recorded against the band it was given for, so the daily job can tell an
   * answered warning from a new one. The coach is not saying the client is
   * fine — only that this particular warning has been dealt with.
   */
  async dismiss(coachId: string, clientId: string): Promise<RetentionEntry[]> {
    if (!(await this.accessService.isCoachOf(coachId, clientId))) {
      throw new ForbiddenException('This is not your client.');
    }

    const { data, error: readError } = await this.supabase
      .from('client_retention')
      .select('band')
      .eq('coach_id', coachId)
      .eq('user_id', clientId)
      .maybeSingle();

    if (readError) {
      throw new Error(`Error reading retention row: ${readError.message}`);
    }
    if (!data) {
      throw new NotFoundException('This client has not been scored yet.');
    }

    const { error } = await this.supabase
      .from('client_retention')
      .update({
        dismissed_at: new Date().toISOString(),
        dismissed_band: data.band as string,
      })
      .eq('coach_id', coachId)
      .eq('user_id', clientId);

    if (error) {
      throw new Error(`Error dismissing retention card: ${error.message}`);
    }

    return this.listForCoach(coachId);
  }

  /**
   * Recompute one coach's roster on demand.
   *
   * No push: the coach is looking at the screen that is about to show the
   * result, and being notified about what you are already reading is noise.
   */
  async refreshForCoach(coachId: string): Promise<RetentionEntry[]> {
    const pairs = await this.approvedPairs(coachId);
    if (pairs.length > 0) {
      await this.recompute(pairs, { notify: false });
    }
    return this.listForCoach(coachId);
  }

  /**
   * Every approved pair, once a day.
   *
   * Early morning: the coach's first look at the app should already carry
   * yesterday's picture, and a client who trained late last night should not be
   * flagged for it.
   */
  @Cron('0 6 * * *')
  async recomputeAll(): Promise<void> {
    try {
      const pairs = await this.approvedPairs();
      if (pairs.length === 0) return;
      await this.recompute(pairs, { notify: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Retention recompute failed: ${message}`);
    }
  }

  private async approvedPairs(coachId?: string): Promise<Pair[]> {
    let query = this.supabase
      .from('coach_user_relations')
      .select(
        `
        coach_id,
        user_id,
        user:coach_user_relations_user_id_fkey ( first_name, last_name )
      `,
      )
      .eq('status', 'approved');

    if (coachId) query = query.eq('coach_id', coachId);

    const { data, error } = await query;
    if (error) {
      throw new Error(`Error fetching coach relations: ${error.message}`);
    }

    return (data ?? [])
      .filter((row) => row.coach_id && row.user_id)
      .map((row) => {
        const user = one(row.user as NameRow | NameRow[] | null);
        return {
          coachId: row.coach_id as string,
          clientId: row.user_id as string,
          firstName: user?.first_name ?? null,
          lastName: user?.last_name ?? null,
        };
      });
  }

  private async recompute(
    pairs: Pair[],
    options: { notify: boolean },
  ): Promise<void> {
    const clientIds = [...new Set(pairs.map((p) => p.clientId))];
    const signalsByPair = await this.collectSignals(pairs, clientIds);
    const stored = await this.fetchStored(pairs);
    const now = new Date().toISOString();

    // Coaches whose client crossed into at_risk this run, for one push each.
    const crossings = new Map<string, string[]>();
    let notesGenerated = 0;

    for (const pair of pairs) {
      const key = `${pair.coachId}:${pair.clientId}`;
      const signals = signalsByPair.get(key);
      if (!signals) continue;

      const { score, band, factors } = scoreClient(signals);
      const inputsHash = this.hashSignals(signals);
      const previous = stored.get(key);

      // Reuse the note whenever the picture is unchanged. A stable client on a
      // daily job would otherwise be re-described every morning in slightly
      // different words, at full price.
      const reusable =
        previous?.inputs_hash === inputsHash && previous?.note
          ? previous
          : null;

      let note: RetentionNote | null = reusable?.note ?? null;
      let model: string | null = reusable?.model ?? null;

      const needsNote = band === 'watch' || band === 'at_risk';
      if (needsNote && !note && notesGenerated < MAX_NOTES_PER_RUN) {
        notesGenerated += 1;
        note = await this.generateNote(pair, signals, factors, score, band);
        model = note ? GEMINI_MODEL : null;
      }
      if (!needsNote) {
        // A calm client carries no note; leaving the last bad one on the row
        // would keep an outdated warning on screen after the problem passed.
        note = null;
        model = null;
      }

      const keepDismissal = dismissalSurvives(
        previous?.dismissed_at ?? null,
        previous?.dismissed_band ?? null,
        band,
      );

      const crossed =
        band === 'at_risk' && previous?.notified_band !== 'at_risk';
      if (options.notify && crossed) {
        const list = crossings.get(pair.coachId) ?? [];
        list.push(pair.firstName ?? 'Klient');
        crossings.set(pair.coachId, list);
      }

      const notifiedBand =
        band === 'at_risk'
          ? options.notify || previous?.notified_band === 'at_risk'
            ? 'at_risk'
            : (previous?.notified_band ?? null)
          : band;

      const { error } = await this.supabase.from('client_retention').upsert(
        {
          coach_id: pair.coachId,
          user_id: pair.clientId,
          computed_at: now,
          score,
          band,
          factors,
          signals,
          note,
          model,
          inputs_hash: inputsHash,
          notified_band: notifiedBand,
          notified_at:
            notifiedBand === 'at_risk' && crossed
              ? now
              : (previous?.notified_at ?? null),
          dismissed_at: keepDismissal ? previous!.dismissed_at : null,
          dismissed_band: keepDismissal ? previous!.dismissed_band : null,
        },
        { onConflict: 'coach_id,user_id' },
      );

      if (error) {
        this.logger.error(
          `Storing retention for ${pair.clientId} failed: ${error.message}`,
        );
      }
    }

    for (const [coachId, names] of crossings) {
      this.notificationsService.notifyUser(coachId, {
        title: 'Klienti potřebují pozornost',
        body: droppedOffBody(names),
        data: { type: 'retention_alert' },
      });
    }
  }

  private async fetchStored(pairs: Pair[]): Promise<Map<string, StoredRow>> {
    const coachIds = [...new Set(pairs.map((p) => p.coachId))];
    const { data, error } = await this.supabase
      .from('client_retention')
      .select(
        `coach_id, user_id, inputs_hash, note, model, notified_band,
         notified_at, dismissed_at, dismissed_band`,
      )
      .in('coach_id', coachIds)
      .returns<StoredRow[]>();

    if (error) {
      // Losing the previous rows only costs a regenerated note and a possible
      // repeated push; failing the whole run would cost the day's scores.
      this.logger.warn(`Reading stored retention failed: ${error.message}`);
      return new Map();
    }

    return new Map(
      (data ?? []).map((row) => [`${row.coach_id}:${row.user_id}`, row]),
    );
  }

  // ── signals ────────────────────────────────────────────────────────────────

  /**
   * Every signal for the whole batch in six queries.
   *
   * Per-client fetching would be six times the roster: a gym with 200 clients
   * would open its morning with 1200 round trips. Workouts, meals and weigh-ins
   * are per client; chat and meetings belong to the pair, since a client with
   * two coaches is silent towards one of them and not the other.
   */
  private async collectSignals(
    pairs: Pair[],
    clientIds: string[],
  ): Promise<Map<string, RetentionSignals>> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
    const halfStart = new Date(now.getTime() - HALF_WINDOW_DAYS * 86_400_000);
    const sinceDate = windowStart.toISOString().slice(0, 10);
    const sinceTs = windowStart.toISOString();

    const [
      { data: workouts, error: workoutError },
      { data: meals, error: mealsError },
      { data: messages, error: chatError },
      { data: meetings, error: meetingsError },
      { data: weights, error: weightError },
      { data: programDays, error: programError },
    ] = await Promise.all([
      this.supabase
        .from('workout_logs')
        .select(
          `
          workout_date,
          completed,
          user_workout_programs!inner ( user_id ),
          exercise_logs ( id ),
          cardio_logs ( id )
        `,
        )
        .in('user_workout_programs.user_id', clientIds)
        .gte('workout_date', sinceDate),

      this.supabase
        .from('meals')
        .select('user_id, meal_time')
        .in('user_id', clientIds)
        .gte('meal_time', `${sinceDate} 00:00:00+00`),

      this.supabase
        .from('chat_messages')
        .select('coach_id, user_id, sender_id, created_at')
        .in('user_id', clientIds)
        .gte('created_at', sinceTs),

      this.supabase
        .from('gym_meetings')
        .select('coach_id, client_id, status, starts_at')
        .in('client_id', clientIds)
        .gte('starts_at', sinceTs),

      this.supabase
        .from('user_weight')
        .select('user_id, created_at')
        .in('user_id', clientIds)
        .gte('created_at', sinceTs),

      this.supabase
        .from('user_program_days')
        .select(
          'week_number, user_workout_programs!inner ( user_id, status, start_date )',
        )
        .in('user_workout_programs.user_id', clientIds)
        .eq('user_workout_programs.status', 'active'),
    ]);

    for (const [label, error] of [
      ['workout logs', workoutError],
      ['meals', mealsError],
      ['chat messages', chatError],
      ['meetings', meetingsError],
      ['weigh-ins', weightError],
      ['program days', programError],
    ] as const) {
      if (error) throw new Error(`Error fetching ${label}: ${error.message}`);
    }

    // Per client.
    const workoutDates = new Map<string, Date[]>();
    for (const row of workouts ?? []) {
      // A session counts when the client actually trained in it: either they
      // marked it finished, or something got logged inside it. `completed` is a
      // button in the app — someone who put twelve sets in and never tapped it
      // was in the gym all the same, while a day that was opened and left empty
      // was never a session at all.
      const logged =
        (row.exercise_logs?.length ?? 0) > 0 ||
        (row.cardio_logs?.length ?? 0) > 0;
      if (!row.completed && !logged) continue;

      const userId = one(
        row.user_workout_programs as
          | { user_id: string }
          | { user_id: string }[],
      )?.user_id;
      if (!userId) continue;
      const list = workoutDates.get(userId) ?? [];
      list.push(new Date(`${String(row.workout_date).slice(0, 10)}T00:00:00Z`));
      workoutDates.set(userId, list);
    }

    // Days with at least one meal, not meals: three meals on one day is one day
    // of logging, and a client who logs breakfast every morning is the pattern
    // worth measuring.
    const mealDays = new Map<string, Set<string>>();
    for (const row of meals ?? []) {
      const userId = row.user_id as string;
      const day = String(row.meal_time).slice(0, 10);
      const set = mealDays.get(userId) ?? new Set<string>();
      set.add(day);
      mealDays.set(userId, set);
    }

    const lastWeighIn = new Map<string, Date>();
    for (const row of weights ?? []) {
      const userId = row.user_id as string;
      const at = new Date(row.created_at as string);
      const current = lastWeighIn.get(userId);
      if (!current || at > current) lastWeighIn.set(userId, at);
    }

    const programInfo = new Map<
      string,
      { weeks: Set<number>; days: number; start: Date | null }
    >();
    for (const row of programDays ?? []) {
      const program = one(
        row.user_workout_programs as
          | { user_id: string; start_date: string | null }
          | { user_id: string; start_date: string | null }[],
      );
      if (!program?.user_id) continue;
      const entry = programInfo.get(program.user_id) ?? {
        weeks: new Set<number>(),
        days: 0,
        start: null,
      };
      entry.weeks.add((row.week_number as number | null) ?? 1);
      entry.days += 1;
      const start = program.start_date ? new Date(program.start_date) : null;
      if (start && (!entry.start || start < entry.start)) entry.start = start;
      programInfo.set(program.user_id, entry);
    }

    // Per pair.
    const lastClientMessage = new Map<string, Date>();
    const chatted = new Set<string>();
    for (const row of messages ?? []) {
      const key = `${row.coach_id as string}:${row.user_id as string}`;
      chatted.add(key);
      // Only the client's own messages: a coach writing into silence is the
      // problem being measured, not evidence against it.
      if (row.sender_id !== row.user_id) continue;
      const at = new Date(row.created_at as string);
      const current = lastClientMessage.get(key);
      if (!current || at > current) lastClientMessage.set(key, at);
    }

    const cancelled = new Map<string, number>();
    const upcoming = new Map<string, number>();
    for (const row of meetings ?? []) {
      const key = `${row.coach_id as string}:${row.client_id as string}`;
      const startsAt = new Date(row.starts_at as string);
      if (row.status === 'cancelled') {
        cancelled.set(key, (cancelled.get(key) ?? 0) + 1);
      }
      if (row.status === 'approved' && startsAt > now) {
        upcoming.set(key, (upcoming.get(key) ?? 0) + 1);
      }
    }

    const result = new Map<string, RetentionSignals>();
    const halfStartDay = halfStart.toISOString().slice(0, 10);

    for (const pair of pairs) {
      const key = `${pair.coachId}:${pair.clientId}`;
      const dates = (workoutDates.get(pair.clientId) ?? []).sort(
        (a, b) => b.getTime() - a.getTime(),
      );
      const days = mealDays.get(pair.clientId) ?? new Set<string>();
      const program = programInfo.get(pair.clientId);

      const mealDaysRecent = [...days].filter((d) => d >= halfStartDay).length;
      const weighIn = lastWeighIn.get(pair.clientId) ?? null;
      const clientMessage = lastClientMessage.get(key) ?? null;

      result.set(key, {
        tenureDays: program?.start
          ? Math.max(0, daysBetween(program.start, now))
          : null,
        plannedSessionsPerWeek: program
          ? Math.round((program.days / (program.weeks.size || 1)) * 10) / 10
          : null,
        daysSinceLastWorkout: dates[0] ? daysBetween(dates[0], now) : null,
        sessionsRecent: dates.filter((d) => d >= halfStart).length,
        sessionsPrevious: dates.filter((d) => d < halfStart).length,
        daysSinceLastMeal: days.size
          ? daysBetween(
              new Date(`${[...days].sort().reverse()[0]}T00:00:00Z`),
              now,
            )
          : null,
        mealDaysRecent,
        mealDaysPrevious: days.size - mealDaysRecent,
        everLoggedMeals: days.size > 0,
        daysSinceClientMessage: clientMessage
          ? daysBetween(clientMessage, now)
          : null,
        everChatted: chatted.has(key),
        cancelledMeetings: cancelled.get(key) ?? 0,
        upcomingMeetings: upcoming.get(key) ?? 0,
        daysSinceLastWeighIn: weighIn ? daysBetween(weighIn, now) : null,
        everWeighedIn: weighIn !== null,
      });
    }

    return result;
  }

  /**
   * Fingerprint of the picture the note was written from.
   *
   * Day counts are already whole days, so a client whose situation is genuinely
   * unchanged hashes the same tomorrow and keeps yesterday's text.
   */
  private hashSignals(signals: RetentionSignals): string {
    return createHash('sha256')
      .update(JSON.stringify(signals))
      .digest('hex')
      .slice(0, 32);
  }

  // ── the model's part ───────────────────────────────────────────────────────

  private async generateNote(
    pair: Pair,
    signals: RetentionSignals,
    factors: RetentionFactor[],
    score: number | null,
    band: RetentionBand,
  ): Promise<RetentionNote | null> {
    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        headline: {
          type: Type.STRING,
          description:
            'At most 4 words naming the problem, e.g. "Přestal chodit na tréninky". No client name.',
        },
        why: {
          type: Type.STRING,
          description:
            '2-3 sentences for the coach explaining what the numbers show, with the concrete numbers in them.',
        },
        suggestedAction: {
          type: Type.STRING,
          description:
            'One imperative step for the coach, at most 8 words, e.g. "Nabídni kratší plán na tento týden".',
        },
        draftMessage: {
          type: Type.STRING,
          description:
            '2-3 sentences the coach can send the client as-is: warm, addressed to them by first name, no guilt, ending in a question.',
        },
      },
      required: ['headline', 'why', 'suggestedAction', 'draftMessage'],
    };

    return this.callGemini<RetentionNote>(
      responseSchema,
      `
      CLIENT FIRST NAME: ${pair.firstName ?? 'klient'}
      RISK SCORE: ${score ?? 'n/a'} of 100 (band: ${band})
      SCORED FACTORS: ${JSON.stringify(factors)}
      SIGNALS (last ${WINDOW_DAYS} days, "recent" = last ${HALF_WINDOW_DAYS} days, "previous" = the ${HALF_WINDOW_DAYS} before that): ${JSON.stringify(signals)}

      TASK: Explain to the coach why this client is at risk of quitting, what to do about it, and draft the message to send them.

      RULES:
      - Base every statement strictly on the SIGNALS and FACTORS; never invent numbers and never recompute the score.
      - A null "daysSince..." means nothing was found in the last ${WINDOW_DAYS} days — say "over a month", never "zero days".
      - An "ever..." flag set to false means the client never had that habit at all. Never describe it as something they stopped doing, and never bring it up as a decline.
      - Lead with the factor that scored highest.
      - "why" and "suggestedAction" are for the coach and talk about the client in the third person.
      - "draftMessage" is written to the client in the second person, and must never mention a score, risk, or that it was generated.
      - Do not diagnose reasons you cannot see (injury, illness, motivation) — ask instead of assuming.
      - Respond in Czech language.
    `,
    );
  }

  private async callGemini<T>(
    responseSchema: Record<string, unknown>,
    contents: string,
  ): Promise<T | null> {
    const maxRetries = 2;

    for (let attempt = 0; ; attempt++) {
      try {
        const response = await this.genAI.models.generateContent({
          model: GEMINI_MODEL,
          config: {
            temperature: 0.4,
            responseMimeType: 'application/json',
            responseSchema,
            systemInstruction:
              'You are an experienced fitness coach helping another coach keep a client who is drifting away.',
          },
          contents,
        });

        if (!response?.text) throw new Error('AI returned an empty response.');
        return JSON.parse(response.text) as T;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const transient =
          /UNAVAILABLE|RESOURCE_EXHAUSTED|"code":(503|429)/.test(message);
        if (transient && attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }

        // The score and its factors stand on their own; a missing note costs
        // the coach a sentence of prose, not the warning itself.
        this.logger.warn(`Retention note generation failed: ${message}`);
        return null;
      }
    }
  }
}
