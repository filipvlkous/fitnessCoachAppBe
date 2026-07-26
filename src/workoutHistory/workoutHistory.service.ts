import { Injectable } from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';
import { localDateStr } from 'utils/getLocalTime';

export type WorkoutDayStatus = 'done' | 'partial' | 'empty' | 'rest';

export interface WeekDayStatus {
  date: string;
  status: WorkoutDayStatus;
  total_exercises: number;
  logged_exercises: number;
  workout_log_id: string | null;
  day_name: string | null;
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

    return [...byExercise.values()]
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
      .sort((a, b) => b.sessions - a.sessions);
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

    return data;
  };
}
