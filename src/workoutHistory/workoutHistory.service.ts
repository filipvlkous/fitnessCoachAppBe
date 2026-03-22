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

  async getWorkoutStreek(id: string) {
    const { data, error } = await this.supabaseService.supabase
      .from('user_workout_programs')
      .select('workout_streek')
      .eq('user_id', id)
      .single();

    if (error?.code === 'PGRST116') {
      return [];
    }
    return data;
  }

  async getWorkoutHistoryForUserDay(id: string) {
    const { data, error } = await this.supabaseService.supabase
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
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching logs:', error);
      return null;
    }

    if (!data || data.length === 0) return null;

    const dayName = data[0].workout_logs?.user_program_days?.day_name ?? null;

    return {
      dayName,
      logs: data.map(({ workout_logs, ...log }) => log),
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
      if (total === 0) status = 'rest';
      else if (logged >= total) status = 'done';
      else if (logged > 0) status = 'partial';

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
}
