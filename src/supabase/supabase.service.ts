import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  public readonly supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_ANON_KEY || '',
    );
  }

  getClient(): SupabaseClient {
    return this.supabase;
  }

  async fetchData(table: string) {
    const { data, error } = await this.supabase.from(table).select('*');

    if (error) {
      throw new Error(`Error fetching data: ${error.message}`);
    }

    return data;
  }

  async fetchDataWithFilter(table: string, column: string, value: any) {
    const { data, error } = await this.supabase
      .from(table)
      .select('*')
      .eq(column, value);

    if (error) {
      throw new Error(`Error fetching data: ${error.message}`);
    }

    return data;
  }

  async saveFoodItems(
    foodItems: string,
    name: string,
    userId: string,
    mealType: string,
    date: string,
    meal_score: number,
  ): Promise<void> {
    try {
      const parsed = JSON.parse(foodItems);

      if (parsed.foodArray === 0) return;

      const { data: daily, error: deErr } = await this.supabase
        .from('daily_entries')
        .select('id')
        .eq('user_id', userId)
        .eq('date', date)
        .maybeSingle();

      let dailyEntryId: string = daily?.id;
      if (deErr || !dailyEntryId) {
        const dailyEntryResponse = await this.supabase
          .from('daily_entries')
          .insert({ user_id: userId, date: date })
          .select('id')
          .single();
        if (!dailyEntryResponse.data) {
          throw new Error('Failed to insert daily entry');
        }
        dailyEntryId = dailyEntryResponse.data.id;
      }

      const { data: mealRow, error: mealErr } = await this.supabase
        .from('meals')
        .insert({
          daily_id: dailyEntryId,
          name: name,
          type: mealType,
          meal_time: date,
          meal_score: meal_score,
        })
        .select('*')
        .single();

      if (mealErr) throw mealErr;

      const ingredients = parsed.foodArray.map((i) => ({
        meal_id: mealRow.id,
        nutritionScore: 20,
        ...i,
      }));

      const { error: ingErr } = await this.supabase
        .from('meal_ingredients')
        .insert(ingredients);

      if (ingErr) throw ingErr;
    } catch (error) {
      console.error(error);
      throw error;
    }
  }
}
