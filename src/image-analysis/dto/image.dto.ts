import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

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

  @ValidateNested()
  @Type(() => ManualFoodItemDto)
  item: ManualFoodItemDto;
}

// Response shapes (not validated request DTOs)
export class FoodItemResponse {
  name: string;
  weight: number;
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
