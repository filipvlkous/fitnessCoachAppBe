import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { GoogleGenAI, Type } from '@google/genai';
import { createHash } from 'crypto';
import { SupabaseService } from 'src/supabase/supabase.service';
import { AccessService } from 'src/auth/access.service';
import {
  BriefFacts,
  BriefMealRow,
  BriefTargetRow,
  BriefWeightRow,
  BriefWorkoutRow,
  briefWindow,
  buildBriefFacts,
  isEmptyBrief,
} from './meeting-brief.facts';

const GEMINI_MODEL = 'gemini-3-flash-preview';

/**
 * How long a generated brief is reused. The key carries a hash of the facts,
 * so anything the client logs in the meantime produces a new brief anyway;
 * this only bounds how long an unchanged one is kept.
 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export type BriefLanguage = 'cs' | 'en';

export interface BriefSummary {
  headline: string;
  wins: string[];
  concerns: string[];
  questions: string[];
}

export interface MeetingBrief {
  facts: BriefFacts;
  /**
   * Null when nothing shared was logged, when the model failed, or — asked
   * for without generating — when no summary is cached yet.
   */
  summary: BriefSummary | null;
}

interface MeetingRow {
  id: string;
  coach_id: string;
  client_id: string;
  starts_at: string;
  status: string;
}

// Unwraps supabase joined relations that may come back as object or array.
const one = <T>(value: T | T[] | null | undefined): T | undefined =>
  Array.isArray(value) ? value[0] : (value ?? undefined);

/**
 * A short read for the coach before an in-person session: what the client did
 * since they last met, in numbers first and a few sentences second.
 *
 * Only what the client shares with the coach goes in — a scope they keep
 * private is left out of both the numbers and the prompt, not just hidden in
 * the app. Chat messages are never sent to the model.
 */
@Injectable()
export class MeetingBriefService {
  private readonly logger = new Logger(MeetingBriefService.name);
  private readonly genAI = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly accessService: AccessService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  private get supabase() {
    return this.supabaseService.supabase;
  }

  async getBrief(
    coachId: string,
    meetingId: string,
    language: BriefLanguage,
    /**
     * False returns the numbers with whatever summary is already cached. The
     * model takes 15-20 s, so the app asks for the numbers this way first and
     * shows them while a second request waits for the text.
     */
    generate = true,
  ): Promise<MeetingBrief> {
    const meeting = await this.loadCoachMeeting(coachId, meetingId);
    // A meeting outlives the relation: once the client has left, their data
    // is no longer this coach's to read, however the meeting row looks.
    await this.accessService.assertSelfOrCoach(coachId, meeting.client_id);
    const previousAt = await this.previousMeetingAt(meeting);
    const { since, until } = briefWindow(
      new Date(meeting.starts_at),
      previousAt,
      new Date(),
    );
    const access = await this.accessService.getCoachDataAccess(
      meeting.client_id,
    );

    const sinceDate = since.toISOString().slice(0, 10);
    const untilDate = until.toISOString().slice(0, 10);
    const [workouts, plannedPerWeek, meals, targets, weights, firstName] =
      await Promise.all([
        access.workouts
          ? this.workouts(meeting.client_id, sinceDate, untilDate)
          : null,
        access.workouts ? this.plannedPerWeek(meeting.client_id) : null,
        access.nutrition
          ? this.meals(meeting.client_id, sinceDate, untilDate)
          : null,
        access.nutrition ? this.targets(meeting.client_id) : null,
        access.bodyMetrics
          ? this.weights(meeting.client_id, since, until)
          : null,
        this.firstName(meeting.client_id),
      ]);

    const facts = buildBriefFacts({
      since,
      until,
      workouts,
      plannedPerWeek,
      meals,
      targets,
      weights,
    });
    if (isEmptyBrief(facts)) return { facts, summary: null };

    const key = `meeting-brief:${meeting.id}:${language}:${hash(facts)}`;
    const cached = await this.cacheManager.get<BriefSummary>(key);
    if (cached || !generate) return { facts, summary: cached ?? null };

    const summary = await this.generate(facts, firstName, language);
    // A failure is not cached, so the next tap tries again.
    if (summary) await this.cacheManager.set(key, summary, CACHE_TTL_MS);
    return { facts, summary };
  }

  // ── the meeting ────────────────────────────────────────────────────────────

  /**
   * The coach's own approved meeting, or 404 — the same answer for "no such
   * meeting" and "not yours", as in `MeetingsService`.
   */
  private async loadCoachMeeting(
    coachId: string,
    meetingId: string,
  ): Promise<MeetingRow> {
    const { data, error } = await this.supabase
      .from('gym_meetings')
      .select('id, coach_id, client_id, starts_at, status')
      .eq('id', meetingId)
      .eq('coach_id', coachId)
      .eq('status', 'approved')
      .maybeSingle<MeetingRow>();

    if (error) {
      throw new InternalServerErrorException(
        `Error loading meeting: ${error.message}`,
      );
    }
    if (!data) throw new NotFoundException('Meeting not found');
    return data;
  }

  private async previousMeetingAt(meeting: MeetingRow): Promise<Date | null> {
    const { data, error } = await this.supabase
      .from('gym_meetings')
      .select('starts_at')
      .eq('coach_id', meeting.coach_id)
      .eq('client_id', meeting.client_id)
      .eq('status', 'approved')
      .lt('starts_at', meeting.starts_at)
      .order('starts_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ starts_at: string }>();

    if (error) {
      throw new InternalServerErrorException(
        `Error loading previous meeting: ${error.message}`,
      );
    }
    return data ? new Date(data.starts_at) : null;
  }

  // ── the client's data ──────────────────────────────────────────────────────

  private async workouts(
    clientId: string,
    since: string,
    until: string,
  ): Promise<BriefWorkoutRow[]> {
    const { data, error } = await this.supabase
      .from('workout_logs')
      .select(
        `
        id,
        workout_date,
        completed,
        user_workout_programs!inner ( user_id ),
        user_program_days ( day_name ),
        exercise_logs ( weight, reps, exercises ( id, name ) )
      `,
      )
      .eq('user_workout_programs.user_id', clientId)
      .gte('workout_date', since)
      .lte('workout_date', until);

    if (error) {
      throw new InternalServerErrorException(
        `Error fetching workouts: ${error.message}`,
      );
    }
    const rows = data ?? [];

    const ratings = await this.ratings(rows.map((row) => row.id as string));

    return rows.map((row) => ({
      date: (row.workout_date as string).slice(0, 10),
      completed: Boolean(row.completed),
      dayName:
        one(
          row.user_program_days as unknown as {
            day_name: string | null;
          } | null,
        )?.day_name ?? null,
      rpe: ratings.get(row.id as string) ?? null,
      sets: (
        (row.exercise_logs ?? []) as {
          weight: number | null;
          reps: number | null;
          exercises: unknown;
        }[]
      ).flatMap((log) => {
        const exercise = one(
          log.exercises as { id: string; name: string } | null,
        );
        return exercise
          ? [
              {
                exerciseId: exercise.id,
                name: exercise.name,
                weight: log.weight,
                reps: log.reps,
              },
            ]
          : [];
      }),
    }));
  }

  /**
   * A query of its own: the column comes with
   * sql/2026-09-16_workout_logs_rpe.sql, and until that runs the brief should
   * only lose the ratings (same reasoning as the coach feed).
   */
  private async ratings(logIds: string[]): Promise<Map<string, number>> {
    if (logIds.length === 0) return new Map();
    const { data, error } = await this.supabase
      .from('workout_logs')
      .select('id, rpe')
      .in('id', logIds);

    if (error) {
      this.logger.warn(`Meeting brief without ratings: ${error.message}`);
      return new Map();
    }
    return new Map(
      ((data ?? []) as { id: string; rpe: number | null }[])
        .filter((row) => row.rpe != null)
        .map((row) => [row.id, row.rpe as number]),
    );
  }

  /** Days in the active plan divided by its weeks, as retention counts it. */
  private async plannedPerWeek(clientId: string): Promise<number | null> {
    const { data, error } = await this.supabase
      .from('user_program_days')
      .select('week_number, user_workout_programs!inner ( user_id, status )')
      .eq('user_workout_programs.user_id', clientId)
      .eq('user_workout_programs.status', 'active');

    if (error || !data || data.length === 0) return null;
    const weeks = new Set(
      data.map((row) => (row.week_number as number | null) ?? 1),
    );
    return Math.round((data.length / weeks.size) * 10) / 10;
  }

  private async meals(
    clientId: string,
    since: string,
    until: string,
  ): Promise<BriefMealRow[]> {
    const { data, error } = await this.supabase
      .from('meals')
      .select('meal_time, total_calories, total_protein')
      .eq('user_id', clientId)
      .gte('meal_time', `${since} 00:00:00+00`)
      .lte('meal_time', `${until} 23:59:59+00`);

    if (error) {
      throw new InternalServerErrorException(
        `Error fetching meals: ${error.message}`,
      );
    }
    return (
      (data ?? []) as {
        meal_time: string;
        total_calories: number | null;
        total_protein: number | null;
      }[]
    ).map((meal) => ({
      date: meal.meal_time.slice(0, 10),
      calories: meal.total_calories ?? 0,
      protein: meal.total_protein ?? 0,
    }));
  }

  private async targets(clientId: string): Promise<BriefTargetRow[]> {
    const { data, error } = await this.supabase
      .from('user_assigned_macros')
      .select('calories, protein')
      .eq('user_id', clientId);

    if (error) {
      throw new InternalServerErrorException(
        `Error fetching macro targets: ${error.message}`,
      );
    }
    return (data ?? []) as BriefTargetRow[];
  }

  private async weights(
    clientId: string,
    since: Date,
    until: Date,
  ): Promise<BriefWeightRow[]> {
    const { data, error } = await this.supabase
      .from('user_weight')
      .select('weight, created_at')
      .eq('user_id', clientId)
      .gte('created_at', since.toISOString())
      .lte('created_at', until.toISOString());

    if (error) {
      throw new InternalServerErrorException(
        `Error fetching weight: ${error.message}`,
      );
    }
    return ((data ?? []) as { weight: number; created_at: string }[]).map(
      (row) => ({ date: row.created_at, weight: row.weight }),
    );
  }

  private async firstName(clientId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('user')
      .select('first_name')
      .eq('id', clientId)
      .maybeSingle<{ first_name: string | null }>();
    return data?.first_name ?? null;
  }

  // ── the model's part ───────────────────────────────────────────────────────

  private async generate(
    facts: BriefFacts,
    firstName: string | null,
    language: BriefLanguage,
  ): Promise<BriefSummary | null> {
    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        headline: {
          type: Type.STRING,
          description:
            'One sentence, at most 12 words: the single most important thing about this client since the last meeting.',
        },
        wins: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description:
            '0-3 short points on what went well, each with its concrete number.',
        },
        concerns: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description:
            '0-3 short points worth raising, each with its concrete number.',
        },
        questions: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description:
            '2-3 questions the coach can ask the client in person, addressed to the client in the second person.',
        },
      },
      required: ['headline', 'wins', 'concerns', 'questions'],
    };

    const contents = `
      CLIENT FIRST NAME: ${firstName ?? 'n/a'}
      FACTS: ${JSON.stringify(facts)}

      TASK: Brief a fitness coach who is about to meet this client in person. Cover the period from "since" to "until" (${facts.days} days).

      RULES:
      - Base every statement strictly on FACTS; never invent or recompute numbers.
      - A section that is null is data the client does not share with the coach. Never mention it, never guess about it.
      - A section with zeros means the client shares it but logged nothing; that may be worth a concern.
      - "rpe" is the client's own 1-10 rating of how hard a whole workout felt (10 = all-out). Never write "RPE"; call it "${language === 'en' ? 'effort' : 'náročnost'}".
      - In "lifts", "first" and "last" are the best set in the first and last session of the period; weight null means bodyweight.
      - Compare against "plannedPerWeek" and the nutrition targets where they exist.
      - Do not diagnose reasons you cannot see (injury, illness, motivation) — turn them into questions instead.
      - Write the points about the client in the third person; write the questions to the client in the second person.
      - Respond in ${language === 'en' ? 'English' : 'Czech'}.
    `;

    const maxRetries = 2;
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await this.genAI.models.generateContent({
          model: GEMINI_MODEL,
          config: {
            temperature: 0.3,
            responseMimeType: 'application/json',
            responseSchema,
            systemInstruction:
              'You are an experienced fitness coach preparing a colleague for a session with their client. Be brief and concrete.',
          },
          contents,
        });

        if (!response?.text) throw new Error('AI returned an empty response.');
        return JSON.parse(response.text) as BriefSummary;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const transient =
          /UNAVAILABLE|RESOURCE_EXHAUSTED|"code":(503|429)/.test(message);
        if (transient && attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        // The numbers stand on their own; the coach loses the prose only.
        this.logger.warn(`Meeting brief generation failed: ${message}`);
        return null;
      }
    }
  }
}

function hash(facts: BriefFacts): string {
  return createHash('sha256')
    .update(JSON.stringify(facts))
    .digest('hex')
    .slice(0, 32);
}
