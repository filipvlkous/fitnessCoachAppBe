import e from 'express';

export class AnalyzeFoodDto {
  imageBase64: string; // e.g. "data:image/png;base64,iVBORw0KGgoAAAANS…"
}

export class AnalyzeFoodResponseDto {
  name: string;
  items: FoodItem[];
  category: string;
  id: string;
  date: Date;
  image: string;
  meal_score: number;
}

export class FoodItem {
  name: string;
  weight: number;
  count: number;
}

export class FoodAnalysisResponse {
  foodTitle: string;
  foodArray: FoodItemResponse[];
}

export class FoodItemResponse {
  name: string;
  weight: number;
  count: number;
  protein: number;
  fat: number;
  carbs: number;
  calories: number;
}
