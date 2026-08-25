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
  program_day_id?: string;
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
  // Absent for an athlete training without a coach.
  coach_id?: string | null;
}

interface LogExerciseDto {
  workout_log_id: string;
  assigned_exercise_id: string;
  exercises_id: string;
  sets: Array<{
    // Client-generated row id, present for sets replayed from the app's
    // offline queue.
    id?: string;
    weight: number | null;
    reps: number;
    set_number: number;
    note?: string;
  }>;
}

// What the user did the last time they trained a given exercise, so a new
// session can be pre-filled with the weights they actually used.
interface LastPerformance {
  workout_log_id: string;
  date: string;
  sets: Array<{
    set_number: number;
    weight: number | null;
    reps: number | null;
    note: string | null;
  }>;
  top_weight: number | null;
}

// How many of the user's most recent workouts to scan when looking for the
// last time each exercise was performed.
const LAST_PERFORMANCE_LOOKBACK_SESSIONS = 40;

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

  // Create the athlete's own coach-less program, or hand back the active one
  // they already have. Idempotent on purpose: the home screen calls this from a
  // button, and a double tap must not fork the plan into two active programs.
  // Returns the same shape as getUserActiveProgram so the caller can drop it
  // straight into the home query cache.
  async createSoloProgram(userId: string, name?: string) {
    const withDayCounts = `
      *,
      user_program_days (
        *,
        user_assigned_exercises: user_assigned_exercises (
          count
        )
      )
    `;

    const { data: existing, error: existingError } = await this.supabase
      .from('user_workout_programs')
      .select(withDayCounts)
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('start_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throw new InternalServerErrorException(existingError.message);
    }
    if (existing) return existing;

    const { data, error } = await this.supabase
      .from('user_workout_programs')
      .insert({
        user_id: userId,
        coach_id: null,
        name: name?.trim() || 'Můj plán',
        start_date: new Date().toISOString().split('T')[0],
        status: 'active',
      })
      .select(withDayCounts)
      .single();

    if (error) throw new InternalServerErrorException(error.message);
    return data;
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

    return this.sortProgramDayExercises(program);
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

    if (error) throw new InternalServerErrorException(error.message);
    return data;
  }

  // Delete program (returns owner IDs so the controller can invalidate their caches)
  async deleteProgram(programId: string) {
    const { data: program } = await this.supabase
      .from('user_workout_programs')
      .select('user_id, coach_id')
      .eq('id', programId)
      .maybeSingle();

    const { error } = await this.supabase
      .from('user_workout_programs')
      .delete()
      .eq('id', programId);

    if (error) throw new InternalServerErrorException(error.message);
    return {
      message: 'Program deleted successfully',
      user_id: program?.user_id ?? null,
      coach_id: program?.coach_id ?? null,
    };
  }

  // ============================================
  // EXERCISE ORDERING
  // ============================================

  // PostgREST returns embedded rows in whatever order Postgres hands them
  // back, which changes as soon as a row is updated. The coach's chosen order
  // only survives a round-trip if we sort by `sort_order` explicitly, so every
  // read path that exposes assigned exercises goes through this.
  // `created_at` is the tie-breaker so rows written before ordering existed
  // (all sharing sort_order 0) still come back in a stable sequence.
  private sortAssignedExercises<T extends Record<string, any>>(
    exercises: T[] | null | undefined,
  ): T[] {
    if (!Array.isArray(exercises)) return [];
    return [...exercises].sort((a, b) => {
      const orderDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
      if (orderDiff !== 0) return orderDiff;
      return String(a.created_at ?? '').localeCompare(
        String(b.created_at ?? ''),
      );
    });
  }

  // Same, for a program payload whose days each embed their exercises.
  private sortProgramDayExercises<T extends Record<string, any>>(
    program: T | null | undefined,
  ): T | null | undefined {
    if (!program || !Array.isArray(program.user_program_days)) return program;
    return {
      ...program,
      user_program_days: program.user_program_days.map((day: any) => ({
        ...day,
        user_assigned_exercises: this.sortAssignedExercises(
          day?.user_assigned_exercises,
        ),
      })),
    };
  }

  // Get user's active program.
  // Uses limit(1) + maybeSingle so duplicate active programs don't error out.
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
      .order('start_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }
    return data ?? {};
  }

  async getUserActiveDay(programId: string, dayNumber: number) {
    const { data, error } = await this.supabase
      .from('user_program_days')
      .select(
        `
          *,
          user_workout_programs!inner ( user_id ),
         user_assigned_exercises (
            *,
            exercises (*)
          )
      `,
      )
      .eq('program_id', programId)
      .eq('day_number', dayNumber)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }
    if (!data) return {};

    return this.withLastPerformance(data);
  }

  // ============================================
  // LAST PERFORMANCE (PREVIOUS WEIGHTS)
  // ============================================

  // Strips the program embed used only to resolve the athlete and decorates
  // every assigned exercise with `last_performance`.
  private async withLastPerformance(day: any) {
    const { user_workout_programs, ...rest } = day;
    const program = Array.isArray(user_workout_programs)
      ? user_workout_programs[0]
      : user_workout_programs;
    const userId: string | undefined = program?.user_id;

    const assigned = this.sortAssignedExercises(rest.user_assigned_exercises);
    const exerciseIds = [
      ...new Set(
        assigned.map((ex) => ex.exercise_id).filter(Boolean) as string[],
      ),
    ];

    const lastByExercise = userId
      ? await this.getLastPerformanceByExercise(userId, exerciseIds)
      : new Map<string, LastPerformance>();

    return {
      ...rest,
      user_assigned_exercises: assigned.map((ex) => ({
        ...ex,
        last_performance: lastByExercise.get(ex.exercise_id) ?? null,
      })),
    };
  }

  // For each exercise id, the sets logged the last time the user trained it.
  // One query over the user's most recent workouts; the newest log that
  // contains an exercise wins, so an exercise skipped last week still keeps
  // the weights from the week before.
  async getLastPerformanceByExercise(
    userId: string,
    exerciseIds: string[],
  ): Promise<Map<string, LastPerformance>> {
    const result = new Map<string, LastPerformance>();
    if (exerciseIds.length === 0) return result;

    const { data, error } = await this.supabase
      .from('workout_logs')
      .select(
        `
        id,
        workout_date,
        user_workout_programs!inner ( user_id ),
        exercise_logs (
          exercises_id,
          set_number,
          weight,
          reps,
          note
        )
      `,
      )
      .eq('user_workout_programs.user_id', userId)
      // Filters the embedded rows, so we only carry sets we actually need.
      .in('exercise_logs.exercises_id', exerciseIds)
      .order('workout_date', { ascending: false })
      .limit(LAST_PERFORMANCE_LOOKBACK_SESSIONS);

    if (error) {
      // Previous weights are a convenience: never fail opening a workout day.
      console.error('Error fetching last performance:', error);
      return result;
    }

    // Logs arrive newest first, so the first log holding an exercise is the
    // most recent one and later logs must not overwrite it.
    for (const log of data ?? []) {
      for (const setLog of (log as any).exercise_logs ?? []) {
        const exerciseId = setLog.exercises_id;
        if (!exerciseId) continue;

        let entry = result.get(exerciseId);
        if (!entry) {
          entry = {
            workout_log_id: (log as any).id,
            date: (log as any).workout_date,
            sets: [],
            top_weight: null,
          };
          result.set(exerciseId, entry);
        } else if (entry.workout_log_id !== (log as any).id) {
          continue; // older session, we already have a newer one
        }

        entry.sets.push({
          set_number: setLog.set_number,
          weight: setLog.weight,
          reps: setLog.reps,
          note: setLog.note ?? null,
        });
        if (setLog.weight != null) {
          entry.top_weight = Math.max(entry.top_weight ?? 0, setLog.weight);
        }
      }
    }

    for (const entry of result.values()) {
      entry.sets.sort((a, b) => (a.set_number ?? 0) - (b.set_number ?? 0));
    }

    return result;
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
      .order('start_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }
    return this.sortProgramDayExercises(data) ?? {};
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

    if (error) throw new InternalServerErrorException(error.message);
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

    if (error) throw new InternalServerErrorException(error.message);
    return data;
  }

  // Delete a day (and all its exercises)
  async deleteProgramDay(dayId: string) {
    const { error } = await this.supabase
      .from('user_program_days')
      .delete()
      .eq('id', dayId);

    if (error) throw new InternalServerErrorException(error.message);
    return { message: 'Day deleted successfully' };
  }

  // Get a specific day with all exercises
  async getProgramDay(dayId: string) {
    const { data, error } = await this.supabase
      .from('user_program_days')
      .select(
        `
        *,
        user_workout_programs!inner ( user_id ),
        user_assigned_exercises (
          *,
          exercises (*)
        )
      `,
      )
      .eq('id', dayId)
      .single();

    if (error) throw new NotFoundException('Day not found');
    return this.withLastPerformance(data);
  }

  async updateProgramDayName(user_program_day_id: string, name: string) {
    const { data, error } = await this.supabase
      .from('user_program_days')
      .update({ day_name: name })
      .eq('id', user_program_day_id)
      .select()
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
    if (error) throw new InternalServerErrorException(error.message);
    return data;
  }

  // Add exercise to a day. The day always comes from the route param so the
  // body cannot write into another program's day.
  async addExerciseToDay(
    dto: AddExerciseDto | AddExerciseDto[],
    dayId: string,
  ) {
    const items = Array.isArray(dto) ? dto : [dto];
    const sanitized = items.map(
      ({
        exercise_id,
        planned_sets,
        planned_reps,
        planned_weight,
        rest_seconds,
        sort_order,
        notes,
      }) => ({
        program_day_id: dayId,
        exercise_id,
        planned_sets,
        planned_reps,
        planned_weight,
        rest_seconds,
        sort_order,
        notes,
      }),
    );
    // Return the created rows: the coach client holds optimistic placeholder
    // IDs for these until it can swap in the real ones, and without them a
    // follow-up reorder would try to update rows that don't exist.
    const { data, error } = await this.supabase
      .from('user_assigned_exercises')
      .insert(sanitized)
      .select('id, exercise_id, sort_order');

    if (error) throw new InternalServerErrorException(error.message);
    return data ?? [];
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

    if (error) throw new InternalServerErrorException(error.message);

    // The assigned-exercise row has no user_id; resolve the athlete via the day.
    const athleteId = await this.getAthleteIdForDay(data.program_day_id);
    if (athleteId) {
      this.notificationsService.notifyUser(athleteId, {
        title: 'Exercise Updated',
        body: `Your coach has updated an exercise in your program. Check it out!`,
      });
    }

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

    if (error) throw new InternalServerErrorException(error.message);

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
    if (firstError) throw new InternalServerErrorException(firstError.message);

    return results.map((result) => result.data);
  }

  // Everything the controller needs to invalidate the caches touching a day:
  // the athlete it belongs to plus the program/day coordinates that key the
  // athlete's "active day" response.
  async getDayContext(dayId: string): Promise<{
    athleteId: string | null;
    programId: string | null;
    dayNumber: number | null;
  }> {
    const { data, error } = await this.supabase
      .from('user_program_days')
      .select('program_id, day_number, user_workout_programs!inner(user_id)')
      .eq('id', dayId)
      .single();

    if (error || !data) {
      return { athleteId: null, programId: null, dayNumber: null };
    }

    const programs = data['user_workout_programs'] as
      | { user_id: string }
      | { user_id: string }[];
    const athleteId = Array.isArray(programs)
      ? (programs[0]?.user_id ?? null)
      : (programs?.user_id ?? null);

    return {
      athleteId,
      programId: data.program_id ?? null,
      dayNumber: data.day_number ?? null,
    };
  }

  // Resolve the athlete's user_id from a program day id.
  // Used by the controller to invalidate the correct user's cache when a coach mutates a day.
  async getAthleteIdForDay(dayId: string): Promise<string | null> {
    const { athleteId } = await this.getDayContext(dayId);
    return athleteId;
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
      .eq('program_day_id', dto.program_day_id)
      .eq('workout_date', workoutDate)
      .limit(1)
      .maybeSingle();

    if (existing) return existing; // { id }

    const { data, error } = await this.supabase
      .from('workout_logs')
      .insert({
        coach_id: dto.coach_id ?? null,
        program_day_id: dto.program_day_id,
        user_workout_program_id: dto.workout_id,
        workout_date: workoutDate,
        completed: false,
      })
      .select('id')
      .single();

    if (error) throw new InternalServerErrorException(error.message);

    return data; // { id }
  }

  // Log exercise sets
  async logExerciseSets(dto: LogExerciseDto) {
    if (!dto.sets || dto.sets.length === 0) {
      throw new BadRequestException('No sets provided');
    }

    const exerciseLogs = dto.sets.map((set) => ({
      // Only set when the client generated one (a set logged offline and
      // replayed later); otherwise the column default assigns it.
      ...(set.id ? { id: set.id } : {}),
      workout_log_id: dto.workout_log_id,
      assigned_exercise_id: dto.assigned_exercise_id,
      exercises_id: dto.exercises_id,
      set_number: set.set_number,
      weight: set.weight,
      reps: set.reps,
      note: set.note || null,
    }));

    // Upsert rather than insert: a queued set whose response was lost gets
    // replayed, and the second attempt must be a no-op, not a duplicate.
    const { error } = await this.supabase
      .from('exercise_logs')
      .upsert(exerciseLogs, { onConflict: 'id', ignoreDuplicates: true });

    if (error) throw new InternalServerErrorException(error.message);
    return true;
  }

  // Complete a workout
  async completeWorkout(
    workoutLogId: string,
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

    if (error) throw new InternalServerErrorException(error.message);

    // Notify the coach (if any); a missing coach or push failure must not
    // fail the completed workout.
    const { data: relation } = await this.supabase
      .from('coach_user_relations')
      .select('coach_id')
      .eq('user_id', userId)
      .eq('status', 'approved')
      .limit(1)
      .maybeSingle();

    if (relation?.coach_id) {
      this.notificationsService.notifyUser(relation.coach_id, {
        title: 'Workout Completed!',
        body: 'One of your clients just completed a workout. Check their performance!',
        data: {
          type: 'workout_completed',
          userId,
        },
      });
    }

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

    if (error) throw new InternalServerErrorException(error.message);
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

    if (error) throw new InternalServerErrorException(error.message);
    return data;
  }

  async logCardio(dto: {
    id?: string;
    workout_log_id: string;
    cardio_type: string;
    duration_minutes: number;
    distance_km?: number | null;
    intensity?: string | null;
  }) {
    // See logExerciseSets: a client-supplied id makes an offline replay
    // idempotent.
    const { error, data } = await this.supabaseService.supabase
      .from('cardio_logs')
      .upsert(
        {
          ...(dto.id ? { id: dto.id } : {}),
          workout_log_id: dto.workout_log_id,
          cardio_type: dto.cardio_type,
          duration_minutes: dto.duration_minutes,
          distance_km: dto.distance_km ?? null,
          intensity: dto.intensity ?? null,
        },
        { onConflict: 'id', ignoreDuplicates: true },
      )
      .select()
      .single();

    if (error) {
      console.error('Error logging cardio:', error);
      return null;
    }

    return data;
  }
}
