import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
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

export class AnalyzeFoodDto {
  // e.g. "data:image/png;base64,iVBORw0KGgoAAAANS…"
  @IsString()
  @IsNotEmpty()
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

// Response shapes (not validated request DTOs)
export class FoodItemResponse {
  name: string;
  weight: number;
  unit?: FoodUnit;
  count: number;
  protein: number;
  fat: number;
  carbs: number;
  calories: number;
}

export class FoodAnalysisResponse {
  foodTitle: string;
  foodArray: FoodItemResponse[];
}
