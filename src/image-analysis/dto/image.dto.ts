import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * How an amount was measured. Grams and millilitres share one scale here:
 * nutrition databases publish per 100 g for solids and per 100 ml for drinks in
 * the same fields, so `weight` means the same number either way and the unit is
 * the label that makes 330 ml of beer read correctly instead of 330 g.
 */
export const FOOD_UNITS = ['g', 'ml'] as const;
export type FoodUnit = (typeof FOOD_UNITS)[number];

/**
 * Base64 inflates by a third, so this is roughly a 7.5 MB source image —
 * comfortably above what any phone camera produces at full resolution, and
 * bounded enough that concurrent scans cannot exhaust the container's memory.
 * The body parser in `main.ts` is capped just above it so an oversized upload
 * is refused before it is ever buffered.
 */
export const MAX_IMAGE_BASE64_CHARS = 10 * 1024 * 1024;

export class AnalyzeFoodDto {
  // e.g. "data:image/png;base64,iVBORw0KGgoAAAANS…"
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_IMAGE_BASE64_CHARS, {
    message: 'Image is too large; send a photo under roughly 7 MB.',
  })
  imageBase64: string;
}

export class FoodItem {
  @IsString()
  name: string;

  @IsNumber()
  weight: number;

  @IsOptional()
  @IsNumber()
  count?: number;
}

export class AnalyzeFoodResponseDto {
  @IsString()
  name: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FoodItem)
  items: FoodItem[];

  @IsString()
  category: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsNumber()
  meal_score?: number;
}

export class ManualFoodItemDto {
  @IsString()
  name: string;

  @IsNumber()
  weight: number;

  /** Defaults to grams — older clients do not send it. */
  @IsOptional()
  @IsIn(FOOD_UNITS)
  unit?: FoodUnit;

  /**
   * How the amount reads to a person — "🍳 2 kusy (100 g)". The photo scan
   * sends these; the manual food form has no serving concept and omits them,
   * in which case the history shows the plain weight.
   */
  @IsOptional()
  @IsString()
  emoji?: string;

  @IsOptional()
  @IsNumber()
  servings?: number;

  @IsOptional()
  @IsString()
  servingLabel?: string;

  @IsOptional()
  @IsNumber()
  servingGrams?: number;

  @IsNumber()
  protein: number;

  @IsNumber()
  fat: number;

  @IsNumber()
  carbs: number;

  @IsNumber()
  calories: number;
}

export class ManualFoodEntryDto {
  @IsString()
  name: string;

  @IsString()
  category: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsNumber()
  meal_score?: number;

  /**
   * Every ingredient of the meal, stored as one meal record. Preferred over
   * `item`, which older clients send one request per ingredient with — that
   * turned a single dish into several entries in the food history.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManualFoodItemDto)
  items?: ManualFoodItemDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ManualFoodItemDto)
  item?: ManualFoodItemDto;
}

// ── Response shapes (documentation only — not validated request DTOs) ──
//
// The authoritative types live in image-analysis.service.ts; these mirror them
// for Swagger. Keep them in step with `AnalyzedFoodItem` / `MealAnalysis`.

export class Per100Response {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export class FoodItemResponse {
  name: string;
  /** Single emoji for the row thumbnail. */
  emoji: string;
  /** "2 kusy (100 g)" — servings × servingGrams is the weight. */
  servings: number;
  servingLabel: string;
  servingGrams: number;
  weight: number;
  unit: FoodUnit;
  /** Basis for the macros below; lets a client rescale an edited amount. */
  per100: Per100Response;
  protein: number;
  fat: number;
  carbs: number;
  calories: number;
}

export class FoodAnalysisResponse {
  /** Which branch the router took: an eaten meal, or a printed label. */
  kind: 'meal' | 'label';
  foodTitle: string;
  mealScore: number;
  /** Serving text off a label, e.g. "1 porce (30 g)". Null for meal photos. */
  servingLabel: string | null;
  foodArray: FoodItemResponse[];
}
