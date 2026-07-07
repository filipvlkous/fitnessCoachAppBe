// src/exercises/dto/exercise.dto.ts
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateExerciseDto {
  @IsNotEmpty()
  @IsString()
  name!: string;

  @IsNotEmpty()
  @IsString()
  muscle_group!: string;

  @IsString()
  description?: string;
}

export class UpdateExerciseCatalogDto {
  @IsString()
  name?: string;

  @IsString()
  muscle_group?: string;

  @IsString()
  description?: string;
}
