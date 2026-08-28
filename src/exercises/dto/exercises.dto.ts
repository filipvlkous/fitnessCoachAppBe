// src/exercises/dto/exercise.dto.ts
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateExerciseDto {
  @IsNotEmpty()
  @IsString()
  name!: string;

  @IsNotEmpty()
  @IsString()
  muscle_group!: string;

  @IsString()
  description?: string;

  // Optional YouTube link. Validated for real (an 11-character video id must be
  // extractable) in ExercisesService, which also turns '' into null so the app
  // can clear it; the length cap here only keeps junk out of the parser.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  youtube_url?: string;
}

export class UpdateExerciseCatalogDto {
  @IsString()
  name?: string;

  @IsString()
  muscle_group?: string;

  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  youtube_url?: string;
}
