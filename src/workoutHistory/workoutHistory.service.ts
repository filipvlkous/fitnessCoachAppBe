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
    user_program_days!inner(
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
