import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsDateString,
} from 'class-validator';

export class UpdateUserDto {
  @IsNumber()
  @IsNotEmpty({ message: 'ID is required and must be a number.' })
  id: number;

  @IsString()
  @IsNotEmpty({ message: 'Username is required.' })
  username: string;

  @IsString()
  @IsNotEmpty({ message: 'Role is required.' })
  role: string;

  @IsDateString()
  @IsNotEmpty({
    message: 'Creation date is required and must be a valid ISO date string.',
  })
  created_at: string;

  // Fitness & Nutrition
  @IsNumber()
  @IsOptional()
  calories?: number;

  @IsNumber()
  @IsOptional()
  fats?: number;

  @IsNumber()
  @IsOptional()
  carbs?: number;

  @IsNumber()
  @IsOptional()
  proteins?: number;

  // Profile
  @IsString()
  @IsOptional()
  sex?: string;

  @IsNumber()
  @IsOptional()
  age?: number;

  @IsNumber()
  @IsOptional()
  height?: number;

  @IsNumber()
  @IsOptional()
  weight?: number;

  @IsNumber()
  @IsOptional()
  weightChange?: number;

  @IsString()
  @IsOptional()
  diet?: string;

  @IsString()
  @IsOptional()
  goal?: string;

  @IsString()
  @IsOptional()
  activityLevel?: string;
}

export class UpdateProfileDto {
  @IsNumber()
  @IsOptional()
  weight?: number;

  @IsNumber()
  @IsOptional()
  height?: number;

  @IsNumber()
  @IsOptional()
  age?: number;

  @IsString()
  @IsOptional()
  sex?: string;

  @IsString()
  @IsOptional()
  goal?: string;

  @IsString()
  @IsOptional()
  activity_level?: string;

  @IsString()
  @IsOptional()
  bio?: string;
}
