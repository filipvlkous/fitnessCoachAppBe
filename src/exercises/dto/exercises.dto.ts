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

/**
 * A coach's own version of a shared catalogue exercise. Both fields follow the
 * same three-state convention the catalogue uses: omit the key to leave the
 * stored value alone, send '' to clear it back to the catalogue's, send text to
 * override. The image is not here — it is a file, uploaded through its own
 * endpoint.
 */
export class UpsertCoachExerciseVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  youtube_url?: string;
}
