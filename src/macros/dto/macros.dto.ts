import { IsInt, IsNotEmpty, Min } from 'class-validator';

export class SetMacrosDto {
  @IsInt()
  @IsNotEmpty()
  day: number;

  @IsInt()
  @Min(0)
  calories: number;

  @IsInt()
  @Min(0)
  protein: number;

  @IsInt()
  @Min(0)
  carbs: number;

  @IsInt()
  @Min(0)
  fats: number;
}
