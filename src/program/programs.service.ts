// src/programs/programs.service.ts
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from 'src/notifications/notifications.service';

// ============================================
// DTOs & Types
// ============================================

interface ProgramDay {
  week_number: number;
  day_number: number;
  day_name: string;
  notes?: string;
  exercises: {
    exercise_id: string;
    planned_sets: number;
    planned_reps: number;
    planned_weight?: number;
    rest_seconds?: number;
    sort_order: number;
    notes?: string;
  }[];
}

interface CreateUserProgramDto {
  user_id: string;
  coach_id: string;
  name: string;
  description?: string;
  start_date: string;
  end_date?: string;
  days: ProgramDay[];
}

interface UpdateProgramDto {
  name?: string;
  description?: string;
  end_date?: string;
  status?: 'active' | 'paused' | 'completed';
}

interface CreateProgramDayDto {
  program_id: string;
  week_number: number;
  day_number: number;
  day_name: string;
  notes?: string;
}

interface UpdateProgramDayDto {
  day_name?: string;
  notes?: string;
}

interface AddExerciseDto {
  program_day_id: string;
  exercise_id: string;
  planned_sets: number;
  planned_reps: number;
  planned_weight?: number;
  rest_seconds?: number;
  sort_order: number;
  notes?: string;
}

interface UpdateExerciseDto {
  planned_sets?: number;
  planned_reps?: number;
  planned_weight?: number;
  rest_seconds?: number;
  sort_order?: number;
  notes?: string;
}

interface LogWorkoutDto {
  program_day_id: string;
  workout_id: string;
  workout_date: string;
}

interface LogExerciseDto {
  workout_log_id: string;
  assigned_exercise_id: string;
  exercises_id: string;
  sets: Array<{
    weight: number | null;
    reps: number;
    set_number: number;
    note?: string;
  }>;
}

@Injectable()
export class ProgramsService {
  constructor(
    private supabaseService: SupabaseService,
    private notificationsService: NotificationsService,
  ) {}

  private get supabase() {
    return this.supabaseService.getClient();
  }

  // ============================================
  // PROGRAM MANAGEMENT (COACH)
  // ============================================

  // Create a complete program for a user
  async createUserProgram(dto: CreateUserProgramDto) {
    const { days, ...programData } = dto;

    // 1. Create the program
    const { data: program, error: programError } = await this.supabase
      .from('user_workout_programs')
      .insert(programData)
      .select()
      .single();

    if (programError) {
      throw new InternalServerErrorException(programError.message);
    }

    try {
      // 2. Create days and exercises
      for (const day of days) {
        const { exercises, ...dayData } = day;

        // Create day
        const { data: programDay, error: dayError } = await this.supabase
          .from('user_program_days')
          .insert({
            program_id: program.id,
            ...dayData,
          })
          .select()
          .single();

        if (dayError) throw dayError;

        // Add exercises to this day
        if (exercises && exercises.length > 0) {
          const exercisesWithDay = exercises.map((ex) => ({
            program_day_id: programDay.id,
            ...ex,
          }));

          const { error: exercisesError } = await this.supabase
            .from('user_assigned_exercises')
            .insert(exercisesWithDay);

          if (exercisesError) throw exercisesError;
        }
      }

      return this.getUserProgram(program.id);
    } catch (err: any) {
      // Rollback
      await this.supabase
        .from('user_workout_programs')
        .delete()
        .eq('id', program.id);

      throw new InternalServerErrorException(
        'Failed to create program: ' + err.message,
      );
    }
  }

  // Get program with all days and exercises
  async getUserProgram(programId: string) {
    const { data: program, error } = await this.supabase
      .from('user_workout_programs')
      .select(
        `
        *,
        user_program_days (
          *,
          user_assigned_exercises (
            *,
            exercises (
              id,
              name,
              muscle_group
            )
          )
        )
      `,
      )
      .eq('id', programId)
      .single();

    if (error) throw new NotFoundException('Program not found');

    return program;
  }

  // Update program details
  async updateProgram(programId: string, updates: UpdateProgramDto) {
    const { data, error } = await this.supabase
      .from('user_workout_programs')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', programId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  // Delete program
  async deleteProgram(programId: string) {
    const { error } = await this.supabase
      .from('user_workout_programs')
      .delete()
      .eq('id', programId);

    if (error) throw new Error(error.message);
    return { message: 'Program deleted successfully' };
  }

  // Get user's active program
  async getUserActiveProgram(userId: string) {
    const { data, error } = await this.supabase
      .from('user_workout_programs')
      .select(
        `
    *,
    user_program_days (
      *,
      user_assigned_exercises: user_assigned_exercises (
        count
      )
    )
  `,
      )
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return {};
      }
      throw new NotFoundException('No active program found');
    }
    return data;
  }

  async getUserActiveDay(programId: string, dayNumber: number) {
    const { data, error } = await this.supabase
      .from('user_program_days')
      .select(
        `
          *,
         user_assigned_exercises (
            *,
            exercises (*)
          )
      `,
      )
      .eq('program_id', programId)
      .eq('day_number', dayNumber)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return {};
      }
      throw new NotFoundException('No active program found');
    }
    return data;
  }

  async getUserActiveWeek(userId: string) {
    const { data, error } = await this.supabase
      .from('user_workout_programs')
      .select(
        `
        *,
        user_program_days (
          *,
          user_assigned_exercises (
            *,
            exercises (*)
          )
        )
      `,
      )
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return {};
      }
      throw new NotFoundException('No active program found');
    }
    return data;
  }

  // Get all programs for a user
  async getUserPrograms(userId: string) {
    const { data, error } = await this.supabase
      .from('user_workout_programs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return data;
  }

  // Get all programs created by a coach
  async getCoachPrograms(coachId: string) {
    const { data, error } = await this.supabase
      .from('user_workout_programs')
      .select(
        `
        *,
        users!user_workout_programs_user_id_fkey (
          id,
          first_name,
          last_name,
          email
        )
      `,
      )
      .eq('coach_id', coachId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return data;
  }

  // ============================================
  // DAY MANAGEMENT (COACH)
  // ============================================

  // Add a new day to a program
  async createProgramDay(dto: CreateProgramDayDto) {
    const { data, error } = await this.supabase
      .from('user_program_days')
      .insert(dto)
      .select('id')
      .single();

    if (error) throw new Error(error.message);
    return { id: data.id };
  }

  // Update day details
  async updateProgramDay(dayId: string, updates: UpdateProgramDayDto) {
    const { data, error } = await this.supabase
      .from('user_program_days')
      .update(updates)
      .eq('id', dayId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  // Delete a day (and all its exercises)
  async deleteProgramDay(dayId: string) {
    const { error } = await this.supabase
      .from('user_program_days')
      .delete()
      .eq('id', dayId);

    if (error) throw new Error(error.message);
    return { message: 'Day deleted successfully' };
  }

  // Get a specific day with all exercises
  async getProgramDay(dayId: string) {
    const { data, error } = await this.supabase
      .from('user_program_days')
      .select(
        `
        *,
        user_assigned_exercises (
          *,
          exercises (*)
        )
      `,
      )
      .eq('id', dayId)
      .single();

    if (error) throw new NotFoundException('Day not found');
    return data;
  }

  // Get day by week and day number
  async getProgramDayByNumber(
    programId: string,
    weekNumber: number,
    dayNumber: number,
  ) {
    const { data, error } = await this.supabase
      .from('user_program_days')
      .select(
        `
        *,
        user_assigned_exercises (
          *,
          exercises (*)
        )
      `,
      )
      .eq('program_id', programId)
      .eq('week_number', weekNumber)
      .eq('day_number', dayNumber)
      .single();

    if (error) throw new NotFoundException('Day not found');
    return data;
  }

  async updateProgramDayName(user_program_day_id: string, name: string) {
    const { data, error } = await this.supabase
      .from('user_program_days')
      .update({ day_name: name })
      .eq('id', user_program_day_id)

      .single();

    if (error) throw new NotFoundException('Day not found');
    return data;
  }

  // ============================================
  // EXERCISE MANAGEMENT (COACH)
  // ============================================

  async getAllExercises() {
    const { data, error } = await this.supabase
      .from('exercises')
      .select('id, name, muscle_group')
      .order('name');
    if (error) throw new Error(error.message);
    return data;
  }

  // Add exercise to a day
  async addExerciseToDay(dto: AddExerciseDto | AddExerciseDto[], id: string) {
    const items = Array.isArray(dto) ? dto : [dto];
    const sanitized = items.map(
      ({
        program_day_id,
        exercise_id,
        planned_sets,
        planned_reps,
        planned_weight,
        rest_seconds,
        sort_order,
        notes,
      }) => ({
        program_day_id,
        exercise_id,
        planned_sets,
        planned_reps,
        planned_weight,
        rest_seconds,
        sort_order: sort_order + 1,
        notes,
      }),
    );
    const { error } = await this.supabase
      .from('user_assigned_exercises')
      .insert(sanitized)
      .eq('program_day_id', id);

    if (error) throw new Error(error.message);
    return true;
  }

  // Update assigned exercise
  async updateAssignedExercise(
    assignedExerciseId: string,
    updates: UpdateExerciseDto,
  ) {
    const { data, error } = await this.supabase
      .from('user_assigned_exercises')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', assignedExerciseId)
      .select(
        `
        *,
        exercises (*)
      `,
      )
      .single();

    if (error) throw new Error(error.message);

    this.notificationsService.sendToUser(data.user_id, {
      title: 'Exercise Updated',
      body: `Your coach has updated an exercise in your program. Check it out!`,
    });

    return data;
  }

  // Remove exercise from a day
  async removeExerciseFromDay(assignedExerciseId: string) {
    const { data, error } = await this.supabase
      .from('user_assigned_exercises')
      .delete()
      .eq('id', assignedExerciseId)
      .select('program_day_id')
      .single();

    if (error) throw new Error(error.message);

    // this.notificationsService.sendToUser(data.user_id, {
    //   title: 'Exercise Removed',
    //   body: `Your coach has removed an exercise from your program. Check your updated plan!`,})


    return {
      message: 'Exercise removed successfully',
      program_day_id: data?.program_day_id,
    };
  }

  async updateAssignedExercises(
    dayId: string,
    exercises: Array<Partial<AddExerciseDto> & { id: string }>,
  ) {
    if (!exercises || exercises.length === 0) {
      return [];
    }

    const results = await Promise.all(
      exercises.map(async (ex) => {
        const {
          id,
          exercise_id,
          planned_sets,
          planned_reps,
          planned_weight,
          rest_seconds,
          sort_order,
          notes,
        } = ex;

        return this.supabase
          .from('user_assigned_exercises')
          .update({
            ...(exercise_id !== undefined && { exercise_id }),
            ...(planned_sets !== undefined && { planned_sets }),
            ...(planned_reps !== undefined && { planned_reps }),
            ...(planned_weight !== undefined && { planned_weight }),
            ...(rest_seconds !== undefined && { rest_seconds }),
            ...(sort_order !== undefined && { sort_order }),
            ...(notes !== undefined && { notes }),
            program_day_id: dayId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', id)
          .eq('program_day_id', dayId)
          .select()
          .single();
      }),
    );

    const firstError = results.find((result) => result.error)?.error;
    if (firstError) throw new Error(firstError.message);

    return results.map((result) => result.data);
  }

  // Resolve the athlete's user_id from a program day id.
  // Used by the controller to invalidate the correct user's cache when a coach mutates a day.
  async getAthleteIdForDay(dayId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('user_program_days')
      .select('user_workout_programs!inner(user_id)')
      .eq('id', dayId)
      .single();

    if (error || !data) return null;
    const programs = data['user_workout_programs'] as
      | { user_id: string }
      | { user_id: string }[];
    return Array.isArray(programs)
      ? (programs[0]?.user_id ?? null)
      : (programs?.user_id ?? null);
  }

  // ============================================
  // WORKOUT LOGGING (USER)
  // ============================================

  // Start a workout session
  async logWorkout(dto: LogWorkoutDto) {
    const workoutDate = new Date(dto.workout_date).toISOString();

    // Return existing log if one already exists for this day + date
    const { data: existing } = await this.supabase
      .from('workout_logs')
      .select('id')
      .eq('user_workout_program_id', dto.workout_id)
      .eq('workout_date', workoutDate)
      .maybeSingle();

    if (existing) return existing; // { id }

    const { data, error } = await this.supabase
      .from('workout_logs')
      .insert({
        program_day_id: dto.program_day_id,
        user_workout_program_id: dto.workout_id,
        workout_date: workoutDate,
        completed: false,
      })
      .select('id')
      .single();

    if (error) throw new Error(error.message);

    return data; // { id }
  }

  // Log exercise sets
  async logExerciseSets(dto: LogExerciseDto) {
    if (!dto.sets || dto.sets.length === 0) {
      throw new BadRequestException('No sets provided');
    }

    const exerciseLogs = dto.sets.map((set, index) => ({
      workout_log_id: dto.workout_log_id,
      assigned_exercise_id: dto.assigned_exercise_id,
      exercises_id: dto.exercises_id,
      set_number: set.set_number,
      weight: set.weight,
      reps: set.reps,
      note: set.note || null,
    }));

    const { data, error } = await this.supabase
      .from('exercise_logs')
      .insert(exerciseLogs);

    if (error) throw new Error(error.message);
    return true;
  }

  // Complete a workout
  async completeWorkout(
    workoutLogId: string,
    program_day_id: string,
    userId: string,
    durationMinutes?: number,
  ) {
    const { data, error } = await this.supabase
      .from('workout_logs')
      .update({
        completed: true,
        duration_minutes: durationMinutes,
      })
      .eq('id', workoutLogId)
      .select()
      .single();

    const { data: relation, error: relationError } = await this.supabase
      .from('coach_user_relations')
      .select('coach_id')
      .eq('user_id', userId)
      .single();

    if (relationError || !relation) {
      console.error('No coach found for user:', relationError);
      return;
    }

    if (relation.coach_id) {
      this.notificationsService.sendToUser(relation.coach_id, {
        title: 'Workout Completed!',
        body: `Great job on completing your workout! You can review your performance and keep up the good work!`,
        data: {
          type: 'workout_completed',
          userId,
        },
      });
    }

    if (error) throw new Error(error.message);
    return data;
  }

  // Get workout log with details
  async getWorkoutLog(workoutLogId: string) {
    const { data, error } = await this.supabase
      .from('workout_logs')
      .select(
        `
        *,
        user_program_days (
          *,
          user_workout_programs (
            name,
            user_id,
            coach_id
          )
        ),
        exercise_logs (
          *,
          user_assigned_exercises (
            *,
            exercises (*)
          )
        ),
        workout_comments (*)
      `,
      )
      .eq('id', workoutLogId)
      .single();

    if (error) throw new NotFoundException('Workout log not found');
    return data;
  }

  // Get workout history for a user
  async getWorkoutHistory(userId: string, limit = 30) {
    const { data, error } = await this.supabase
      .from('workout_logs')
      .select(
        `
        *,
        user_program_days!inner (
          *,
          user_workout_programs!inner (
            user_id,
            name,
            coach_id
          )
        ),
        exercise_logs (
          *,
          user_assigned_exercises (
            exercises (name, muscle_group)
          )
        )
      `,
      )
      .eq('user_program_days.user_workout_programs.user_id', userId)
      .order('workout_date', { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    return data;
  }

  // ============================================
  // COMMENTS
  // ============================================

  // Add workout comment
  async addWorkoutComment(
    workoutLogId: string,
    userId: string,
    authorRole: 'user' | 'coach',
    message: string,
  ) {
    const { data, error } = await this.supabase
      .from('workout_comments')
      .insert({
        workout_log_id: workoutLogId,
        user_id: userId,
        author_role: authorRole,
        message,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  // Get workout comments
  async getWorkoutComments(workoutLogId: string) {
    const { data, error } = await this.supabase
      .from('workout_comments')
      .select(
        `
        *,
        users (
          first_name,
          last_name
        )
      `,
      )
      .eq('workout_log_id', workoutLogId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);
    return data;
  }

  // ============================================
  // ANALYTICS / PROGRESS
  // ============================================

  // Get exercise progress for a user
  async getExerciseProgress(userId: string, exerciseId: string, limit = 20) {
    const { data, error } = await this.supabase
      .from('exercise_logs')
      .select(
        `
        *,
        workout_logs!inner (
          workout_date,
          user_program_days!inner (
            week_number,
            day_number,
            user_workout_programs!inner (
              user_id
            )
          )
        ),
        user_assigned_exercises!inner (
          exercise_id,
          planned_weight,
          planned_reps
        )
      `,
      )
      .eq(
        'workout_logs.user_program_days.user_workout_programs.user_id',
        userId,
      )
      .eq('user_assigned_exercises.exercise_id', exerciseId)
      .order('workout_logs.workout_date', { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    return data;
  }

  // Get user workout stats
  async getUserWorkoutStats(userId: string) {
    const { data: workouts, error } = await this.supabase
      .from('workout_logs')
      .select(
        `
        id,
        completed,
        workout_date,
        duration_minutes,
        user_program_days!inner (
          user_workout_programs!inner (user_id)
        )
      `,
      )
      .eq('user_program_days.user_workout_programs.user_id', userId);

    if (error) throw new Error(error.message);

    const completedWorkouts = workouts?.filter((w) => w.completed) || [];
    const totalDuration = completedWorkouts.reduce(
      (sum, w) => sum + (w.duration_minutes || 0),
      0,
    );

    return {
      total_workouts: workouts?.length || 0,
      completed_workouts: completedWorkouts.length,
      total_duration_minutes: totalDuration,
      average_duration_minutes:
        completedWorkouts.length > 0
          ? Math.round(totalDuration / completedWorkouts.length)
          : 0,
    };
  }

  // Get program progress (for coach dashboard)
  async getProgramProgress(programId: string) {
    const program = await this.getUserProgram(programId);

    const { data: workouts } = await this.supabase
      .from('workout_logs')
      .select(
        `
        *,
        user_program_days!inner (program_id)
      `,
      )
      .eq('user_program_days.program_id', programId);

    const totalExercises =
      program.user_program_days?.reduce(
        (sum, day) => sum + (day.user_assigned_exercises?.length || 0),
        0,
      ) || 0;

    const completedWorkouts = workouts?.filter((w) => w.completed).length || 0;

    return {
      program_id: programId,
      program_name: program.name,
      total_days: program.user_program_days?.length || 0,
      total_exercises: totalExercises,
      total_workouts_logged: workouts?.length || 0,
      completed_workouts: completedWorkouts,
      last_workout_date: workouts?.[0]?.workout_date || null,
    };
  }

  async logCardio(dto: {
    workout_log_id: string;
    cardio_type: string;
    duration_minutes: number;
    distance_km?: number | null;
    intensity?: string | null;
  }) {
    const { error, data } = await this.supabaseService.supabase
      .from('cardio_logs')
      .insert({
        workout_log_id: dto.workout_log_id,
        cardio_type: dto.cardio_type,
        duration_minutes: dto.duration_minutes,
        distance_km: dto.distance_km ?? null,
        intensity: dto.intensity ?? null,
      })
      .select()
      .single();

    if (error) {
      console.error('Error logging cardio:', error);
      return null;
    }

    return data;
  }
}
