import { Injectable } from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';
import { SetMacrosDto } from './dto/macros.dto';
import { NotificationsService } from 'src/notifications/notifications.service';
import { getDayName } from 'utils/dayName';

@Injectable()
export class MacrosService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async getUserMacros(userId: string) {
    const { data, error } = await this.supabaseService.supabase
      .from('user_assigned_macros')
      .select('day, calories, protein, carbs, fats')
      .eq('user_id', userId);

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`Error fetching getUserMacros macros: ${error.message}`);
    }
    return data;
  }

  async getUserDayMacro(userId: string, day: number) {
    const { data, error } = await this.supabaseService.supabase
      .from('user_assigned_macros')
      .select('day, calories, protein, carbs, fats')
      .eq('user_id', userId)
      .eq('day', day)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return {
          day: day,
          calories: 0,
          protein: 0,
          carbs: 0,
          fats: 0,
        };
      }
      throw new Error(
        `Error fetching getUserDayMacro macros: ${error.message}`,
      );
    }
    return data;
  }

  async setUserMacros(userId: string, macros: SetMacrosDto) {
    const { day, ...macroData } = macros;

    const { data, error } = await this.supabaseService.supabase
      .from('user_assigned_macros')
      .upsert(
        { user_id: userId, day, ...macroData },
        { onConflict: 'user_id,day' },
      );

    if (error) throw new Error(`Error setting macros: ${error.message}`);

    this.notificationsService.notifyUser(userId, {
      title: 'Macros Updated',
      body: `Your macros for ${getDayName(day)} have been updated.`,
    });
    return data;
  }

  async getDailyMacros(userId: string, date: string) {
    // Half-open range [date, date + 1 day) so no second of the day is missed.
    const nextDay = new Date(`${date}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const nextDayStr = nextDay.toISOString().slice(0, 10);

    const { data, error } = await this.supabaseService.supabase
      .from('meals')
      .select('total_calories, total_carbs, total_fat, total_protein')
      .eq('user_id', userId)
      .gte('meal_time', `${date} 00:00:00+00`)
      .lt('meal_time', `${nextDayStr} 00:00:00+00`);

    if (error) {
      throw new Error(`Error fetching daily macros: ${error.message}`);
    }

    const totals = (data || []).reduce(
      (acc, meal) => ({
        total_calories: acc.total_calories + (meal.total_calories || 0),
        total_carbs: acc.total_carbs + (meal.total_carbs || 0),
        total_fat: acc.total_fat + (meal.total_fat || 0),
        total_protein: acc.total_protein + (meal.total_protein || 0),
      }),
      { total_calories: 0, total_carbs: 0, total_fat: 0, total_protein: 0 },
    );

    return totals;
  }
}
