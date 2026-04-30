import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

type FoodItem = {
  name: string;
  calories: number;
  carbs: number;
  fat: number;
  protein: number;
  weight: number;
  nutritionScore: number;
};

@Injectable()
export class SupabaseService {
  public readonly supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_ANON_KEY || '',
    );
  }

  async validateUserToken(token: string) {
    const { data, error } = await this.supabase.auth.getUser(token);

    if (error || !data.user) {
      throw new Error('Invalid token');
    }

    return data.user; // { id, email, role, etc. }
  }

  getClient(): SupabaseClient {
    return this.supabase;
  }

  async fetchData(table: string) {
    const { data, error } = await this.supabase.from(table).select('*');
    if (error) throw new Error(`Error fetching data: ${error.message}`);
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
      const parsed: { foodArray: FoodItem[] } = JSON.parse(foodItems);

      if (parsed.foodArray.length === 0) return;

      const totals = parsed.foodArray.reduce(
        (acc, item) => ({
          total_calories: Math.round(acc.total_calories + (item.calories || 0)),
          total_carbs: Math.round(acc.total_carbs + (item.carbs || 0)),
          total_fat: Math.round(acc.total_fat + (item.fat || 0)),
          total_protein: Math.round(acc.total_protein + (item.protein || 0)),
          total_weight: Math.round(acc.total_weight + (item.weight || 0)),
          item_count: acc.item_count + 1,
        }),
        {
          total_calories: 0,
          total_carbs: 0,
          total_fat: 0,
          total_protein: 0,
          total_weight: 0,
          item_count: 0,
        },
      );

      const { data: mealRow, error: mealErr } = await this.supabase
        .from('meals')
        .insert({
          user_id: userId,
          name: name,
          type: mealType,
          meal_time: date,
          meal_score: meal_score,
          ...totals,
        })
        .select('*')
        .single();

      if (mealErr) throw mealErr;

      const ingredients = parsed.foodArray.map((i) => ({
        meal_id: mealRow.id,
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
