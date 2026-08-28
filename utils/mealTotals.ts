/**
 * The one place a meal's stored totals and its ingredient rows are derived.
 *
 * `meals` keeps a denormalised copy of what its `meal_ingredients` add up to,
 * and two paths now write both: logging a meal (`SupabaseService.saveFoodItems`)
 * and editing one (`MacrosService.updateMeal`). A second copy of this
 * arithmetic is exactly how an edited meal ends up showing a calorie total its
 * own ingredient list does not add up to, so both paths go through here.
 */

export type MealItemInput = {
  name: string;
  calories: number;
  carbs: number;
  fat: number;
  protein: number;
  weight: number;
  /** 'g' or 'ml'; anything else (including absent) is stored as grams. */
  unit?: string;
  nutritionScore?: number;
  /**
   * How the amount reads to a person — "🍳 2 kusy (100 g)". Set by the photo
   * scan; absent for the manual food form, which has no serving concept, and
   * for anything logged before these columns existed.
   */
  emoji?: string;
  servings?: number;
  servingLabel?: string;
  servingGrams?: number;
};

export type MealTotals = {
  total_calories: number;
  total_carbs: number;
  total_fat: number;
  total_protein: number;
  total_weight: number;
  item_count: number;
};

export function mealTotals(items: MealItemInput[]): MealTotals {
  return items.reduce<MealTotals>(
    (acc, item) => ({
      total_calories: Math.round(acc.total_calories + (item.calories || 0)),
      total_carbs: Math.round(acc.total_carbs + (item.carbs || 0)),
      total_fat: Math.round(acc.total_fat + (item.fat || 0)),
      total_protein: Math.round(acc.total_protein + (item.protein || 0)),
      // Amounts are summed regardless of unit: a dish mixing 200 g of rice
      // with 300 ml of milk has no single meaningful total, so clients that
      // care read the per-ingredient units instead.
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
}

// One decimal, not a whole number: a 5 g pinch of herbs is 0.1 g of protein,
// and rounding that to 0 made the ingredient rows fail to add up to the meal's
// own totals.
const round1 = (n: number) => Math.round((n || 0) * 10) / 10;

/** `meal_ingredients` rows for one meal, in insert shape. */
export function ingredientRows(mealId: string, items: MealItemInput[]) {
  return items.map((i) => ({
    meal_id: mealId,
    name: i.name,
    weight: Math.round(i.weight || 0),
    unit: i.unit === 'ml' ? 'ml' : 'g',
    protein: round1(i.protein),
    fat: round1(i.fat),
    carbs: round1(i.carbs),
    calories: Math.round(i.calories || 0),
    nutritionScore: Math.round(i.nutritionScore || 0),
    // Null rather than a default: the history distinguishes "logged as 2
    // kusy" from "logged as a plain weight" and renders them differently.
    emoji: i.emoji ?? null,
    servings: i.servings ?? null,
    serving_label: i.servingLabel ?? null,
    serving_grams: i.servingGrams ?? null,
  }));
}
