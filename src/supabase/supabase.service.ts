import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
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
  /** Data client. Uses the service-role key when available (RLS bypassed server-side). */
  public readonly supabase: SupabaseClient;
  /** Anon-key client used only to validate user JWTs. */
  private readonly authClient: SupabaseClient;
  /** Service-role client for auth.admin operations; null when the key is not configured. */
  private readonly adminClient: SupabaseClient | null;

  constructor() {
    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !anonKey) {
      throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set');
    }

    this.supabase = createClient(url, serviceRoleKey || anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.authClient = serviceRoleKey
      ? createClient(url, anonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : this.supabase;
    this.adminClient = serviceRoleKey ? this.supabase : null;
  }

  async validateUserToken(token: string) {
    const { data, error } = await this.authClient.auth.getUser(token);

    if (error || !data.user) {
      throw new Error('Invalid token');
    }

    return data.user; // { id, email, role, etc. }
  }

  getClient(): SupabaseClient {
    return this.supabase;
  }

  /** Client for auth.admin operations. Requires SUPABASE_SERVICE_ROLE_KEY. */
  getAdminClient(): SupabaseClient {
    if (!this.adminClient) {
      throw new InternalServerErrorException(
        'SUPABASE_SERVICE_ROLE_KEY is not configured; admin operations are unavailable',
      );
    }
    return this.adminClient;
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
    let parsed: { foodArray: FoodItem[] };
    try {
      parsed = JSON.parse(foodItems);
    } catch {
      throw new BadRequestException('Invalid food items payload');
    }

    if (!Array.isArray(parsed?.foodArray)) {
      throw new BadRequestException('Food items payload is missing foodArray');
    }
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

    if (mealErr) throw new InternalServerErrorException(mealErr.message);

    const ingredients = parsed.foodArray.map((i) => ({
      meal_id: mealRow.id,
      name: i.name,
      weight: Math.round(i.weight || 0),
      protein: Math.round(i.protein || 0),
      fat: Math.round(i.fat || 0),
      carbs: Math.round(i.carbs || 0),
      calories: Math.round(i.calories || 0),
      nutritionScore: Math.round(i.nutritionScore || 0),
    }));

    const { error: ingErr } = await this.supabase
      .from('meal_ingredients')
      .insert(ingredients);

    if (ingErr) throw new InternalServerErrorException(ingErr.message);
  }
}
