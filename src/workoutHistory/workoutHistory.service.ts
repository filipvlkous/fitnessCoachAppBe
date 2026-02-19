import { Injectable } from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';
import { localDateStr } from 'utils/getLocalTime';

@Injectable()
export class WorkoutHistoryService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async getMonthHistory(date: string) {
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
      .order('workout_date', { ascending: true });

    return data;
  }

  async getWorkoutStreek(id: string) {
    const { data, error } = await this.supabaseService.supabase
      .from('user_workout_programs')
      .select('workout_streek')
      .eq('user_id', id)
      .single();

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
      )
    `,
      )
      .eq('workout_log_id', id)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching logs:', error);
      return null;
    }

    return data;
  }
}
