import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * What the coach types.
 *
 * The brief is free text on purpose — "4-week hypertrophy phase for a beginner
 * with lower back pain" carries goal, level, length and a constraint in one
 * sentence, and a form with a field for each of those is slower to fill in than
 * the sentence is to write. Only the two things the *structure* depends on are
 * separate fields: how many days the week has, and how long a session may run.
 */
export class DraftProgramDto {
  @IsString()
  @Length(10, 1000)
  brief: string;

  @IsInt()
  @Min(1)
  @Max(7)
  daysPerWeek: number;

  @IsInt()
  @IsOptional()
  @Min(20)
  @Max(180)
  sessionMinutes?: number;
}

/** One exercise line of an approved draft. */
export class DraftExerciseDto {
  @IsUUID()
  exerciseId: string;

  @IsInt()
  @Min(1)
  @Max(20)
  sets: number;

  @IsInt()
  @Min(1)
  @Max(100)
  reps: number;

  @IsInt()
  @IsOptional()
  @Min(0)
  @Max(600)
  restSeconds?: number;

  @IsString()
  @IsOptional()
  @Length(0, 300)
  notes?: string;
}

/** One day of an approved draft; becomes a `coach_workout_plans` template. */
export class DraftDayDto {
  @IsInt()
  @Min(1)
  @Max(7)
  dayNumber: number;

  @IsString()
  @Length(1, 100)
  name: string;

  @IsString()
  @IsOptional()
  @Length(0, 500)
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DraftExerciseDto)
  exercises: DraftExerciseDto[];
}

/**
 * The draft as the coach approved it — edited or not.
 *
 * The server does not remember what it generated: whatever comes back here is
 * what gets saved. That is what makes the review screen real rather than
 * decorative, and it means a coach can delete every suggestion and keep only
 * the skeleton if that is what they want.
 */
export class ApplyDraftDto {
  @IsString()
  @Length(1, 100)
  name: string;

  @IsString()
  @IsOptional()
  @Length(0, 1000)
  description?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DraftDayDto)
  days: DraftDayDto[];
}
