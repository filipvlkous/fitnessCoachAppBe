import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

// One exercise line inside a coach plan template.
export class PlanExerciseDto {
  @IsString()
  exercise_id: string;

  @IsNumber()
  @Min(1)
  planned_sets: number;

  @IsNumber()
  @Min(1)
  planned_reps: number;

  @IsNumber()
  @IsOptional()
  planned_weight?: number;

  @IsNumber()
  @IsOptional()
  rest_seconds?: number;

  @IsNumber()
  @Min(0)
  sort_order: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreatePlanDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanExerciseDto)
  exercises: PlanExerciseDto[];
}

// Any field may be omitted. If `exercises` is present it replaces the whole
// exercise list. Snapshot model: editing a template only affects FUTURE
// assignments — days already copied to students are never touched.
export class UpdatePlanDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => PlanExerciseDto)
  exercises?: PlanExerciseDto[];
}

// Weekday slots are 1 (Monday) … 7 (Sunday). Numbers above 7 are bonus days —
// extra sessions that hang off the end of the week instead of sitting on a
// calendar day. 14 is the ceiling: it is here because the DTO needs an upper
// bound, not because the app has a reason to stop there. The app names the same
// number in `utils/programDays.ts`, and the column's check constraint in
// `sql/2026-09-03_program_bonus_days.sql`.
export const MAX_PROGRAM_DAY_NUMBER = 14;

// Attach a coach's plan to one of that coach's students.
export class AssignPlanDto {
  @IsString()
  user_id: string;

  // Target program. If omitted, the student's active program is used;
  // if they have none, one is created.
  @IsString()
  @IsOptional()
  program_id?: string;

  @IsNumber()
  @IsOptional()
  @Min(1)
  week_number?: number;

  // The slot to write: 1 (Monday) … 7 (Sunday), or 8 and up for a bonus day.
  // The calendar cannot infer it, so the client always sends the selected slot.
  @IsNumber()
  @Min(1)
  @Max(MAX_PROGRAM_DAY_NUMBER)
  day_number: number;

  // Overrides the plan name for this day; defaults to the plan's name.
  @IsString()
  @IsOptional()
  day_name?: string;
}
