// src/programs/dto/program.dto.ts
import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  IsBoolean,
  IsEnum,
  ValidateNested,
  Min,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

// ============================================
// EXERCISE DTOs
// ============================================

export class ProgramExerciseDto {
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

// ============================================
// DAY DTOs
// ============================================

export class ProgramDayDto {
  @IsNumber()
  @Min(1)
  week_number: number;

  @IsNumber()
  @Min(1)
  day_number: number;

  @IsString()
  day_name: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProgramExerciseDto)
  exercises: ProgramExerciseDto[];
}

export class CreateProgramDayDto {
  @IsString()
  program_id: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  week_number: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  day_number: number;

  @IsString()
  day_name: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateProgramDayDto {
  @IsString()
  @IsOptional()
  day_name?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

// ============================================
// PROGRAM DTOs
// ============================================

export class CreateUserProgramDto {
  @IsString()
  user_id: string;

  @IsString()
  coach_id: string;

  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsDateString()
  start_date: string;

  @IsDateString()
  @IsOptional()
  end_date?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProgramDayDto)
  days: ProgramDayDto[];
}

export class UpdateProgramDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsDateString()
  @IsOptional()
  end_date?: string;

  @IsEnum(['active', 'paused', 'completed'])
  @IsOptional()
  status?: 'active' | 'paused' | 'completed';
}

// ============================================
// EXERCISE MANAGEMENT DTOs
// ============================================

export class AddExerciseDto {
  @IsString()
  program_day_id: string;

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

export class UpdateExerciseDto {
  @IsNumber()
  @IsOptional()
  planned_sets?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  planned_reps?: number;

  @IsNumber()
  @IsOptional()
  planned_weight?: number;

  @IsNumber()
  @IsOptional()
  rest_seconds?: number;

  @IsNumber()
  @IsOptional()
  sort_order?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateAssignedExerciseDto extends UpdateExerciseDto {
  @IsOptional()
  @IsString()
  id: string;

  @IsString()
  @IsOptional()
  exercise_id?: string;
}

export class UpdateExercisesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateAssignedExerciseDto)
  exercises: UpdateAssignedExerciseDto[];
}

// ============================================
// WORKOUT LOGGING DTOs
// ============================================

export class LogWorkoutDto {
  @IsString()
  program_day_id: string;

  @IsString()
  workout_id: string;

  @IsDateString()
  workout_date: string;
}

export class ExerciseSetDto {
  @IsOptional()
  @IsNumber()
  weight: number | null;

  @IsNumber()
  @Min(1)
  reps: number;

  @IsNumber()
  @Min(1)
  week_number: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  rpe?: number;

  @IsString()
  @IsOptional()
  note?: string;

  @IsNumber()
  @Min(1)
  set_number: number;
}

export class LogExerciseDto {
  @IsString()
  workout_log_id: string;

  @IsString()
  assigned_exercise_id: string;

  @IsString()
  exercises_id: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExerciseSetDto)
  sets: ExerciseSetDto[];
}

export class CompleteWorkoutDto {
  @IsString()
  @IsOptional()
  program_day_id?: string;

  @IsNumber()
  @IsOptional()
  duration_minutes?: number;
}

export class LogCardioDto {
  @IsString()
  workout_log_id: string;

  @IsString()
  cardio_type: string;

  @IsNumber()
  @Min(1)
  duration_minutes: number;

  @IsNumber()
  @IsOptional()
  distance_km?: number | null;

  @IsString()
  @IsOptional()
  intensity?: string | null;
}

// ============================================
// COMMENT DTOs
// ============================================

export class AddCommentDto {
  @IsString()
  user_id: string;

  @IsEnum(['user', 'coach'])
  author_role: 'user' | 'coach';

  @IsString()
  message: string;
}
