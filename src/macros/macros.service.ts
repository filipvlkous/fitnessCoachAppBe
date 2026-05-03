import { Injectable } from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';
import { SetMacrosDto } from './dto/macros.dto';

@Injectable()
export class MacrosService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async getUserMacros(userId: string) {
    const { data, error } = await this.supabaseService.supabase
      .from('user_assigned_macros')
      .select('day, calories, protein, carbs, fats')
      .eq('user_id', userId);

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`Error fetching macros: ${error.message}`);
    }
    console.log('Fetched macros:', data);
    return data;
  }

  async getUserDayMacro(userId: string, day: number) {
    const { data, error } = await this.supabaseService.supabase
      .from('user_assigned_macros')
      .select('day, calories, protein, carbs, fats')
      .eq('user_id', userId)
      .eq('day', day).single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`Error fetching macros: ${error.message}`);
    }
    console.log('Fetched macros:', data);
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
    return data;
  }
}
