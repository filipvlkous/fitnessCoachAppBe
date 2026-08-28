import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// One weekday slot of a preset: which day plan goes on which day.
export class PresetDayDto {
  // A `coach_workout_plans` template the coach owns.
  @IsString()
  plan_id: string;

  // 1 = Monday … 7 = Sunday, matching `user_program_days.day_number`.
  @IsNumber()
  @Min(1)
  @Max(7)
  day_number: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  week_number?: number;

  // Overrides the plan's name for this slot.
  @IsString()
  @IsOptional()
  day_name?: string;
}

export class CreatePresetDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PresetDayDto)
  days: PresetDayDto[];
}

// Any field may be omitted. When `days` is present it replaces the whole set of
// slots — the same replace-in-full contract `UpdatePlanDto.exercises` uses.
export class UpdatePresetDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => PresetDayDto)
  days?: PresetDayDto[];
}

// Copy a whole preset into one of the coach's students' programs.
export class AssignPresetDto {
  @IsString()
  user_id: string;

  // Target program. If omitted, the student's active program is used; if they
  // have none, one is created.
  @IsString()
  @IsOptional()
  program_id?: string;

  // Without this an occupied weekday makes the whole assignment fail with 409,
  // listing the days in the way. With it, those days are deleted first — which
  // also drops the sessions logged against them, so the app confirms first.
  @IsBoolean()
  @IsOptional()
  replace_existing?: boolean;
}
