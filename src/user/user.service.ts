import { Injectable } from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';
import { localDateStr } from 'utils/getLocalTime';

@Injectable()
export class UserService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async getAllUsers(userId: string) {
    const { data, error } = await this.supabaseService.supabase
      .from('user') // Assuming the table is named 'user'
      .select('first_name, last_name, id')
      .eq('coach_id', userId)
      .eq('role', 'user');

      console.log('All users data:', data); 

    if (error) {
      if (error.code === '42703') return [];
      throw new Error(`Error fetching user: ${error.message}`);
    }

    return data;
  }
  async getUserById(userId: string) {
    const { data: user, error } = await this.supabaseService.supabase
      .from('user')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      throw new Error(`Error fetching user: ${error.message}`);
    }

    if (user.role !== 'user') {
      return user;
    }

    const { data: relations, error: relationError } =
      await this.supabaseService.supabase
        .from('coach_user_relations')
        .select('*')
        .eq('user_id', user.id);

    if (relationError) {
      throw new Error(
        `Error fetching coach relations: ${relationError.message}`,
      );
    }

    return {
      ...user,
      coach_user_relations: relations,
    };
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
      .from('user') // Assuming the table is named 'user'
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

  async assignUserToCoach(userId: string, code: string) {
    const { data } = await this.supabaseService.supabase
      .from('user')
      .select('id')
      .eq('coach_code', code)
      .single();

    if (!data) throw new Error('Invalid code');
    const { error } = await this.supabaseService.supabase
      .from('coach_user_relations')
      .insert({
        coach_id: data.id,
        user_id: userId,
        status: 'pending',
      });

    if (error) {
      throw new Error(`Error assigning user to coach: ${error.message}`);
    }
    return true;
  }

  async getAssignedUsersToCoach(userId: string, param: string) {
    const { data, error } = await this.supabaseService.supabase
      .from('coach_user_relations')
      .select(
        `
    id,
    status,
    user:coach_user_relations_user_id_fkey (
      user_id:id,
      first_name,
      last_name,
      email
    )
  `,
      )
      .eq(param, userId)
      .in('status', ['approved', 'pending']);

    if (error) {
      throw new Error(`Error fetching assigned users: ${error.message}`);
    }

    return data;
  }

  async approveUser(relationId: string, userId: string) {
    const { error } = await this.supabaseService.supabase
      .from('coach_user_relations')
      .update({ status: 'approved' })
      .eq('id', relationId);

    if (error) {
      throw new Error(`Error approving user: ${error.message}`);
    }

    const { data, error: userError } = await this.supabaseService.supabase
      .from('user_workout_programs')
      .insert({
        user_id: userId,
        name: 'First Program',
        start_date: new Date().toISOString().split('T')[0],
        end_date: null,
        status: 'active',
        workout_streek: 0,
      })
      .select()
      .single();

    if (userError) {
      throw new Error(`Error approving user: ${userError.message}`);
    }

    return data;
  }

  async rejectUser(relationId: string) {
    const { data, error } = await this.supabaseService.supabase
      .from('coach_user_relations')
      .delete()
      .eq('id', relationId)
      .select()
      .single();

    if (error) {
      throw new Error(`Error rejecting user: ${error.message}`);
    }

    return data;
  }

  async getWeightHistory(userId: string, limit: number = 6) {
    const { data, error } = await this.supabaseService.supabase
      .from('user_weight')
      .select('weight, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);


    if (error) {
      throw new Error(`Error fetching weight history: ${error.message}`);
    }

    return data;
  }


  async addWeightEntry(userId: string, weight: number, date?: string) {
    const { data, error } = await this.supabaseService.supabase
      .from('user_weight')
      .insert({
        user_id: userId,
        weight,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Error adding weight entry: ${error.message}`);
    }

    return data;
  }
}
