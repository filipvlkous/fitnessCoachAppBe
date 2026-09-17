import { Injectable } from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';
import { asUtc } from 'utils/as-utc';
import { localDateStr } from 'utils/getLocalTime';
import { countWeightPrs, PrSet, PrWorkout } from './feed-prs';

/** PostgREST's own ceiling; the loop copes with a lower project cap. */
const FEED_PR_PAGE_SIZE = 1000;

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export type WorkoutDayStatus = 'done' | 'partial' | 'empty' | 'rest';

export interface WeekDayStatus {
  date: string;
  status: WorkoutDayStatus;
  total_exercises: number;
  logged_exercises: number;
  workout_log_id: string | null;
  day_name: string | null;
}

export interface CoachFeedRow {
  log_id: string;
  [key: string]: unknown;
}

@Injectable()
export class WorkoutHistoryService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async getMonthHistory(date: string, programDayId: string) {
    const dateObj = new Date(date);

    // Get first day of the month
    const firstDay = new Date(dateObj.getFullYear(), dateObj.getMonth(), 1);
    const firstDayStr = localDateStr(firstDay);

    // Get first day of next month (exclusive end)
    const lastDay = new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 1);
    const lastDayStr = localDateStr(lastDay);

    // Query with range filter directly in this method
    const { data, error } = await this.supabaseService.supabase
      .from('workout_logs')
      .select('id, workout_date,completed')
      .gte('workout_date', firstDayStr) // greater than or equal to first day of month
      .lt('workout_date', lastDayStr) // less than first day of next month
      .order('workout_date', { ascending: true })
      .eq('user_workout_program_id', programDayId);

    if (error) {
      console.error('Error fetching workout history:', error);
      return [];
    } else {
      return data;
    }
  }

  async getWorkoutHistoryForUserDay(id: string) {
    const [
      { data: exerciseData, error: exerciseError },
      { data: cardioData, error: cardioError },
    ] = await Promise.all([
      this.supabaseService.supabase
        .from('exercise_logs')
        .select(
          `
          *,
          exercises (
            name,
            muscle_group
          ),
          workout_logs (
            user_program_days (
              day_name
            )
          )
        `,
        )
        .eq('workout_log_id', id)
        .order('created_at', { ascending: true }),

      this.supabaseService.supabase
        .from('cardio_logs')
        .select('*')
        .eq('workout_log_id', id)
        .order('created_at', { ascending: true }),
    ]);

    if (exerciseError) {
      console.error('Error fetching exercise logs:', exerciseError);
      return null;
    }

    if (cardioError) {
      console.error('Error fetching cardio logs:', cardioError);
      return null;
    }

    const dayName =
      exerciseData?.[0]?.workout_logs?.user_program_days?.day_name ?? null;

    return {
      dayName,
      logs: (exerciseData ?? []).map(({ workout_logs, ...log }) => log),
      cardioLogs: cardioData ?? [],
    };
  }

  async getWorkoutHistoryForUserDayShort(id: string) {
    const [
      { data: workoutLog, error: workoutError },
      { data: exerciseLogs },
      { count: cardioCount },
    ] = await Promise.all([
      this.supabaseService.supabase
        .from('workout_logs')
        .select('user_program_days ( day_name )')
        .eq('id', id)
        .single(),

      this.supabaseService.supabase
        .from('exercise_logs')
        .select('exercises_id')
        .eq('workout_log_id', id),

      this.supabaseService.supabase
        .from('cardio_logs')
        .select('id', { count: 'exact', head: true })
        .eq('workout_log_id', id),
    ]);

    console.log('Workout log:', workoutLog);
    if (workoutError) return null;

    const exerciseCount = new Set(
      (exerciseLogs ?? []).map((e: any) => e.exercises_id),
    ).size;
    const programDay = Array.isArray(workoutLog?.user_program_days)
      ? workoutLog.user_program_days[0]
      : workoutLog?.user_program_days;

    return {
      dayName: programDay?.day_name ?? null,
      exerciseCount: exerciseCount ?? 0,
      cardioCount: cardioCount ?? 0,
    };
  }

  async getWeekStatus(
    userId: string,
    weekStart: string,
  ): Promise<WeekDayStatus[]> {
    // weekStart is 'yyyy-MM-dd' (Monday), compute Sunday (+6 days)
    const start = new Date(weekStart);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const weekEnd = end.toISOString().split('T')[0];

    const { data, error } = await this.supabaseService.supabase
      .from('workout_logs')
      .select(
        `
    id,
    workout_date,
    completed,
    program_day_id,
    user_workout_programs!inner(user_id),
    user_program_days(
      day_name,
      user_assigned_exercises(id)
    ),
    exercise_logs(assigned_exercise_id)
  `,
      )
      .eq('user_workout_programs.user_id', userId)
      .gte('workout_date', weekStart)
      .lte('workout_date', weekEnd);

    if (error) throw error;

    return (data ?? []).map((log) => {
      const programDay = Array.isArray(log.user_program_days)
        ? log.user_program_days[0]
        : log.user_program_days;

      const total = programDay?.user_assigned_exercises?.length ?? 0;
      const logged = new Set(
        (log.exercise_logs ?? []).map((el: any) => el.assigned_exercise_id),
      ).size;

      let status: WorkoutDayStatus = 'empty';

      if (log.completed) status = 'done';
      else if (!log.completed && logged > 0) status = 'partial';
      else if (total === 0) status = 'rest';

      return {
        date: log.workout_date,
        status,
        total_exercises: total,
        logged_exercises: logged,
        workout_log_id: log.id,
        day_name: programDay?.day_name ?? null,
      };
    });
  }

  // Per-exercise progression for a single month. One aggregate query over
  // exercise_logs joined to workout_logs, grouped in JS into: exercise ->
  // per-day best set. "Best" = heaviest weight, tie-broken by reps; for
  // bodyweight exercises (all weights 0/null) it falls back to most reps.
  async getExerciseProgressForMonth(userId: string, month: string) {
    // month is 'YYYY-MM'
    const [year, m] = month.split('-').map(Number);
    const start = localDateStr(new Date(year, m - 1, 1));
    const end = localDateStr(new Date(year, m, 1)); // exclusive

    const { data, error } = await this.supabaseService.supabase
      .from('exercise_logs')
      .select(
        `
        weight,
        reps,
        set_number,
        exercises_id,
        exercises ( id, name, muscle_group ),
        workout_logs!inner (
          workout_date,
          user_workout_programs!inner ( user_id )
        )
      `,
      )
      .eq('workout_logs.user_workout_programs.user_id', userId)
      .gte('workout_logs.workout_date', start)
      .lt('workout_logs.workout_date', end);

    if (error) {
      console.error('Error fetching exercise progress:', error);
      throw error;
    }

    type Row = {
      weight: number | null;
      reps: number | null;
      set_number: number | null;
      exercises_id: string;
      exercises: { id: string; name: string; muscle_group: string } | null;
      workout_logs: { workout_date: string } | null;
    };

    // exercise_id -> { meta, days: date -> aggregated day }
    const byExercise = new Map<
      string,
      {
        exercise_id: string;
        name: string;
        muscle_group: string;
        days: Map<
          string,
          {
            date: string;
            bestWeight: number;
            bestReps: number; // reps of the best set (weight tie-break)
            topReps: number; // most reps in any set (bodyweight metric)
            sets: number;
          }
        >;
      }
    >();

    for (const row of (data ?? []) as unknown as Row[]) {
      const ex = row.exercises;
      const date = row.workout_logs?.workout_date?.split('T')[0];
      if (!ex || !date) continue;

      let entry = byExercise.get(ex.id);
      if (!entry) {
        entry = {
          exercise_id: ex.id,
          name: ex.name,
          muscle_group: ex.muscle_group,
          days: new Map(),
        };
        byExercise.set(ex.id, entry);
      }

      const weight = row.weight ?? 0;
      const reps = row.reps ?? 0;

      const day = entry.days.get(date);
      if (!day) {
        entry.days.set(date, {
          date,
          bestWeight: weight,
          bestReps: reps,
          topReps: reps,
          sets: 1,
        });
      } else {
        day.sets += 1;
        day.topReps = Math.max(day.topReps, reps);
        // Heaviest set wins; equal weight -> more reps wins.
        if (
          weight > day.bestWeight ||
          (weight === day.bestWeight && reps > day.bestReps)
        ) {
          day.bestWeight = weight;
          day.bestReps = reps;
        }
      }
    }

    return (
      [...byExercise.values()]
        .map((entry) => {
          const days = [...entry.days.values()].sort((a, b) =>
            a.date.localeCompare(b.date),
          );
          const bodyweight = days.every((d) => d.bestWeight === 0);
          const entries = days.map((d) => ({
            date: d.date,
            weight: d.bestWeight,
            reps: bodyweight ? d.topReps : d.bestReps,
            sets: d.sets,
          }));
          return {
            exercise_id: entry.exercise_id,
            name: entry.name,
            muscle_group: entry.muscle_group,
            bodyweight,
            sessions: entries.length,
            entries,
          };
        })
        // Most-trained first.
        .sort((a, b) => b.sessions - a.sessions)
    );
  }

  getRecentCoachLogs = async (coachId: string) => {
    const { data, error } = await this.supabaseService.supabase
      .from('workout_summary')
      .select('*')
      .eq('coach_id', coachId) // Filter by the specific coach
      .order('workout_date', { ascending: false }) // Get the most recent dates first
      .limit(10); // Grab only the last 10

    if (error) {
      console.error('Error fetching logs:', error);
      return null;
    }

    return this.withFeedStats(data ?? []);
  };

  // The feed card shows what was actually done, not just that something was.
  // One round of batched queries covers the whole page. The set and cardio
  // stats are the core: if those fail the plain rows go out. Everything else
  // (surname, start time, RPE, plan size, PRs, the latest note) is extra and
  // simply stays null when its query fails.
  private async withFeedStats(logs: CoachFeedRow[]): Promise<CoachFeedRow[]> {
    const logIds = logs.map((l) => l.log_id).filter(Boolean);
    if (logIds.length === 0) return logs;
    const userIds = [
      ...new Set(logs.map((l) => l.user_id as string).filter(Boolean)),
    ];

    const [
      { data: exerciseLogs, error: exerciseError },
      { data: cardioLogs, error: cardioError },
      { data: workoutLogs, error: workoutError },
      { data: ratings, error: ratingError },
      { data: users, error: userError },
    ] = await Promise.all([
      this.supabaseService.supabase
        .from('exercise_logs')
        .select('workout_log_id, exercises_id, weight, reps, note, created_at')
        .in('workout_log_id', logIds),

      this.supabaseService.supabase
        .from('cardio_logs')
        .select('workout_log_id, duration_minutes')
        .in('workout_log_id', logIds),

      this.supabaseService.supabase
        .from('workout_logs')
        .select(
          'id, created_at, user_program_days ( user_assigned_exercises ( id ) )',
        )
        .in('id', logIds),

      // A query of its own: the column comes with
      // sql/2026-09-16_workout_logs_rpe.sql, and until that runs the feed
      // should only lose the RPE.
      this.supabaseService.supabase
        .from('workout_logs')
        .select('id, rpe')
        .in('id', logIds),

      this.supabaseService.supabase
        .from('user')
        .select('id, last_name')
        .in('id', userIds),
    ]);

    if (exerciseError || cardioError) {
      console.error(
        'Error fetching coach feed stats:',
        exerciseError ?? cardioError,
      );
      return logs;
    }
    for (const error of [workoutError, ratingError, userError]) {
      if (error) console.error('Error fetching coach feed details:', error);
    }

    const stats = new Map<
      string,
      {
        exercises: Set<string>;
        sets: number;
        volume: number;
        cardioCount: number;
        cardioMinutes: number;
        note: { text: string; at: string } | null;
      }
    >();

    const entryFor = (logId: string) => {
      let entry = stats.get(logId);
      if (!entry) {
        entry = {
          exercises: new Set<string>(),
          sets: 0,
          volume: 0,
          cardioCount: 0,
          cardioMinutes: 0,
          note: null,
        };
        stats.set(logId, entry);
      }
      return entry;
    };

    for (const row of exerciseLogs ?? []) {
      const entry = entryFor(row.workout_log_id);
      if (row.exercises_id) entry.exercises.add(row.exercises_id);
      entry.sets += 1;
      entry.volume += (row.weight ?? 0) * (row.reps ?? 0);
      // The athlete's most recent note in the session is the one shown.
      const text = (row.note as string | null)?.trim();
      const at = row.created_at as string;
      if (text && (!entry.note || at > entry.note.at)) {
        entry.note = { text, at };
      }
    }

    for (const row of cardioLogs ?? []) {
      const entry = entryFor(row.workout_log_id);
      entry.cardioCount += 1;
      entry.cardioMinutes += row.duration_minutes ?? 0;
    }

    const logMeta = new Map(
      (workoutLogs ?? []).map((row) => [
        row.id as string,
        {
          startedAt: row.created_at as string,
          planned:
            one(
              row.user_program_days as
                | { user_assigned_exercises: unknown[] | null }
                | { user_assigned_exercises: unknown[] | null }[]
                | null,
            )?.user_assigned_exercises?.length ?? null,
        },
      ]),
    );
    const rpeByLog = new Map(
      (ratings ?? []).map((row) => [
        row.id as string,
        row.rpe as number | null,
      ]),
    );
    const lastNames = new Map(
      (users ?? []).map((row) => [
        row.id as string,
        row.last_name as string | null,
      ]),
    );

    const prCounts = await this.feedPrCounts(
      logs,
      logMeta,
      exerciseLogs ?? [],
    ).catch((error) => {
      console.error('Error counting coach feed PRs:', error);
      return null;
    });

    return logs.map((log) => {
      const entry = stats.get(log.log_id);
      const meta = logMeta.get(log.log_id);
      return {
        ...log,
        exercise_count: entry?.exercises.size ?? 0,
        set_count: entry?.sets ?? 0,
        // Tonnage in kg: sum of weight x reps across every logged set.
        total_volume: Math.round(entry?.volume ?? 0),
        cardio_count: entry?.cardioCount ?? 0,
        cardio_minutes: Math.round(entry?.cardioMinutes ?? 0),
        last_name: lastNames.get(log.user_id as string) ?? null,
        // `workout_date` is a date only; this is when the session started.
        // The column has no time zone and holds UTC, so it is marked as such
        // before the app reads it as local time.
        started_at: meta?.startedAt ? asUtc(meta.startedAt) : null,
        rpe: rpeByLog.get(log.log_id) ?? null,
        // Exercises assigned to the day, for "4 of 7" on unfinished sessions.
        planned_exercise_count: meta?.planned ?? null,
        pr_count: prCounts?.get(log.log_id) ?? null,
        note: entry?.note?.text ?? null,
      };
    });
  }

  // Weight PRs per feed workout (see `countWeightPrs`). Reads every weighted
  // set these athletes ever logged on the exercises in the feed, paged because
  // a long history passes PostgREST's row cap.
  private async feedPrCounts(
    logs: CoachFeedRow[],
    logMeta: Map<string, { startedAt: string }>,
    exerciseLogs: { exercises_id: string | null; weight: number | null }[],
  ): Promise<Map<string, number>> {
    const workouts: PrWorkout[] = logs.flatMap((log) => {
      const startedAt = logMeta.get(log.log_id)?.startedAt;
      return startedAt
        ? [
            {
              log_id: log.log_id,
              user_id: log.user_id as string,
              started_at: startedAt,
            },
          ]
        : [];
    });
    const exerciseIds = [
      ...new Set(
        exerciseLogs
          .filter((row) => row.exercises_id && (row.weight ?? 0) > 0)
          .map((row) => row.exercises_id as string),
      ),
    ];
    if (workouts.length === 0 || exerciseIds.length === 0) return new Map();

    const userIds = [...new Set(workouts.map((w) => w.user_id))];
    const sets: PrSet[] = [];
    for (let from = 0; ; ) {
      const { data, error } = await this.supabaseService.supabase
        .from('exercise_logs')
        .select(
          'id, workout_log_id, exercises_id, weight, workout_logs!inner ( created_at, user_workout_programs!inner ( user_id ) )',
        )
        .in('exercises_id', exerciseIds)
        .in('workout_logs.user_workout_programs.user_id', userIds)
        .gt('weight', 0)
        .order('id')
        .range(from, from + FEED_PR_PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;

      for (const row of data) {
        const workoutLog = one(
          row.workout_logs as unknown as
            | { created_at: string; user_workout_programs: unknown }
            | { created_at: string; user_workout_programs: unknown }[],
        );
        const owner = one(
          workoutLog?.user_workout_programs as
            | { user_id: string }
            | { user_id: string }[]
            | null,
        );
        if (!workoutLog || !owner) continue;
        sets.push({
          workout_log_id: row.workout_log_id as string,
          user_id: owner.user_id,
          started_at: workoutLog.created_at,
          exercises_id: row.exercises_id as string,
          weight: Number(row.weight),
        });
      }
      from += data.length;
    }

    return countWeightPrs(workouts, sets);
  }
}
