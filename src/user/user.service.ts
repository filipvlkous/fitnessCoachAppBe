import { Injectable } from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';
import { localDateStr } from 'utils/getLocalTime';

@Injectable()
export class UserService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async getAllUsers(userId: string) {
    const { data, error } = await this.supabaseService.supabase
      .from('users') // Assuming the table is named 'users'
      .select('first_name, last_name, id')
      .eq('coach_id', userId)
      .eq('role', 'user');

    if (error) {
      throw new Error(`Error fetching user: ${error.message}`);
    }

    return data;
  }
  async getUserById(userId: string) {
    const { data, error } = await this.supabaseService.supabase
      .from('users') // Assuming the table is named 'users'
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      throw new Error(`Error fetching user: ${error.message}`);
    }

    return data;
  }

  async getDailyEntries(userId: string, date?: string) {
    // const dateStr = localDateStr(date);

    const { data, error } = await this.supabaseService.supabase
      .from('daily_entries')
      .select('total_calories, total_fat, total_carbs, total_protein')
      .eq('user_id', userId)
      .eq('date', date)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // PGRST116 is the “no rows” error code when you use .single()
        // throw new Error('No daily goal found for the given date and user.');
        return {
          id: 1,
          total_calories: 0,
          total_fat: 0,
          total_carbs: 0,
          total_protein: 0,
        };
      }
      // throw new Error(`Error fetching daily goal: ${error.message}`);
      return null; // Return null instead of throwing an error
    }

    return data;
  }

  async getDailyMeals(userId: string) {
    try {
      const { data: daily_entries, error: userError } =
        await this.supabaseService.supabase
          .from('daily_entries')
          .select('id')
          .eq('user_id', userId)
          .eq('date', localDateStr(new Date()))
          .single();

      const { data, error } = await this.supabaseService.supabase
        .from('meals')
        .select('*')
        .eq('daily_id', daily_entries?.id); // ← make sure we only look at this user’s row

      if (error) {
        if (error.code === 'PGRST116') {
          // PGRST116 is the “no rows” error code when you use .single()
          return [];
        }
        throw new Error(`Error fetching daily goal: ${error.message}`);
      }

      return data;
    } catch (error) {}
  }

  async updateUserFitnessMacros(userId: string, fitnessMacros: any) {
    const { data, error } = await this.supabaseService.supabase
      .from('users') // Assuming the table is named 'users'
      .update({
        fitness_macros: fitnessMacros, // Replace with the actual column name in your database
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      throw new Error(`Error updating fitness macros: ${error.message}`);
    }

    return data;
  }
}
