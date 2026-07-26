import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import {
  AssignPlanDto,
  CreatePlanDto,
  PlanExerciseDto,
  UpdatePlanDto,
} from './dto/coach-plan.dto';

@Injectable()
export class CoachPlansService {
  constructor(
    private supabaseService: SupabaseService,
    private notificationsService: NotificationsService,
  ) {}

  private get supabase() {
    return this.supabaseService.getClient();
  }

  // ============================================
  // PLAN LIBRARY (COACH)
  // ============================================

  // Create a reusable one-day plan owned by the coach.
  async createPlan(coachId: string, dto: CreatePlanDto) {
    const { exercises, ...planData } = dto;

    const { data: plan, error } = await this.supabase
      .from('coach_workout_plans')
      .insert({ ...planData, coach_id: coachId })
      .select()
      .single();

    if (error) throw new InternalServerErrorException(error.message);

    if (exercises?.length) {
      const { error: exError } = await this.supabase
        .from('coach_workout_plan_exercises')
        .insert(exercises.map((ex) => ({ ...ex, plan_id: plan.id })));

      if (exError) {
        // Roll back the header so we never leave a half-created plan.
        await this.supabase
          .from('coach_workout_plans')
          .delete()
          .eq('id', plan.id);
        throw new InternalServerErrorException(exError.message);
      }
    }

    return this.getPlan(plan.id);
  }

  // All plans owned by a coach, with exercise counts for list views.
  async listPlans(coachId: string) {
    const { data, error } = await this.supabase
      .from('coach_workout_plans')
      .select('*, coach_workout_plan_exercises (count)')
      .eq('coach_id', coachId)
      .order('created_at', { ascending: false });

    if (error) throw new InternalServerErrorException(error.message);
    return data;
  }

  // A single plan with its exercises resolved against the catalog.
  async getPlan(planId: string) {
    const { data, error } = await this.supabase
      .from('coach_workout_plans')
      .select(
        `
        *,
        coach_workout_plan_exercises (
          *,
          exercises ( id, name, muscle_group )
        )
      `,
      )
      .eq('id', planId)
      .single();

    if (error) throw new NotFoundException('Plan not found');
    return data;
  }

  // Update plan metadata and (optionally) replace its exercise list.
  // Snapshot model: this only changes the template — days already copied to
  // students are never touched, so per-student tweaks and workout history
  // stay intact. Edits affect future assignments only.
  async updatePlan(planId: string, dto: UpdatePlanDto) {
    const { exercises, ...meta } = dto;

    if (Object.keys(meta).length > 0) {
      const { error } = await this.supabase
        .from('coach_workout_plans')
        .update({ ...meta, updated_at: new Date().toISOString() })
        .eq('id', planId);
      if (error) throw new InternalServerErrorException(error.message);
    }

    if (exercises !== undefined) {
      await this.replacePlanExercises(planId, exercises);
    }

    return this.getPlan(planId);
  }

  // Delete a plan. Its template exercises cascade; already-assigned student days
  // keep their copied exercises (source_plan_id is set null by the FK).
  async deletePlan(planId: string) {
    const { error } = await this.supabase
      .from('coach_workout_plans')
      .delete()
      .eq('id', planId);

    if (error) throw new InternalServerErrorException(error.message);
    return { message: 'Plan deleted successfully' };
  }

  // ============================================
  // ASSIGNMENT (COACH -> STUDENT)
  // ============================================

  // Copy a plan into a student's program as a new day on the given weekday
  // slot (day_number 1–7). Snapshot: the copied day is independent of the
  // template from this point on; source_plan_id is stored as provenance only.
  // Authorization (coach owns plan AND coaches this student) is enforced in the
  // controller via AccessService before this runs.
  async assignPlanToStudent(
    coachId: string,
    planId: string,
    dto: AssignPlanDto,
  ) {
    const plan = await this.getPlan(planId);
    const programId = await this.resolveTargetProgram(coachId, dto);

    // One day per weekday slot: the recurring-week calendar renders a single
    // day per chip, so a second row on the same slot would be inaccessible.
    const { data: existing, error: existingError } = await this.supabase
      .from('user_program_days')
      .select('id')
      .eq('program_id', programId)
      .eq('day_number', dto.day_number)
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throw new InternalServerErrorException(existingError.message);
    }
    if (existing) {
      throw new ConflictException(
        'This weekday already has a workout in the program',
      );
    }

    const { data: day, error: dayError } = await this.supabase
      .from('user_program_days')
      .insert({
        program_id: programId,
        source_plan_id: planId,
        week_number: dto.week_number ?? 1,
        day_number: dto.day_number,
        day_name: dto.day_name ?? plan.name,
        notes: plan.notes ?? null,
      })
      .select('id')
      .single();

    if (dayError) throw new InternalServerErrorException(dayError.message);

    try {
      await this.copyPlanExercisesToDay(planId, day.id);
    } catch (err) {
      // Roll back the day so a failed copy never leaves an empty day behind.
      await this.supabase.from('user_program_days').delete().eq('id', day.id);
      throw err;
    }

    this.notificationsService.notifyUser(dto.user_id, {
      title: 'New Workout Added',
      body: `Your coach added "${plan.name}" to your program.`,
    });

    return { program_id: programId, program_day_id: day.id };
  }

  // ============================================
  // INTERNAL HELPERS
  // ============================================

  // Overwrite a plan's exercise rows with a new list.
  private async replacePlanExercises(
    planId: string,
    exercises: PlanExerciseDto[],
  ) {
    const { error: delError } = await this.supabase
      .from('coach_workout_plan_exercises')
      .delete()
      .eq('plan_id', planId);
    if (delError) throw new InternalServerErrorException(delError.message);

    if (exercises.length) {
      const { error: insError } = await this.supabase
        .from('coach_workout_plan_exercises')
        .insert(exercises.map((ex) => ({ ...ex, plan_id: planId })));
      if (insError) throw new InternalServerErrorException(insError.message);
    }
  }

  // Copy the template's exercises into a program day as user_assigned_exercises.
  private async copyPlanExercisesToDay(planId: string, dayId: string) {
    const { data: planExercises, error } = await this.supabase
      .from('coach_workout_plan_exercises')
      .select(
        'exercise_id, planned_sets, planned_reps, planned_weight, rest_seconds, sort_order, notes',
      )
      .eq('plan_id', planId);

    if (error) throw new InternalServerErrorException(error.message);
    if (!planExercises?.length) return;

    const { error: insError } = await this.supabase
      .from('user_assigned_exercises')
      .insert(
        planExercises.map((ex) => ({ ...ex, program_day_id: dayId })),
      );
    if (insError) throw new InternalServerErrorException(insError.message);
  }

  // Pick the program to attach the day to: explicit id, else the student's
  // active program, else create a fresh one.
  private async resolveTargetProgram(
    coachId: string,
    dto: AssignPlanDto,
  ): Promise<string> {
    if (dto.program_id) return dto.program_id;

    const { data: active } = await this.supabase
      .from('user_workout_programs')
      .select('id')
      .eq('user_id', dto.user_id)
      .eq('status', 'active')
      .order('start_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (active) return active.id;

    const { data: created, error } = await this.supabase
      .from('user_workout_programs')
      .insert({
        user_id: dto.user_id,
        coach_id: coachId,
        name: 'My Program',
        start_date: new Date().toISOString().slice(0, 10),
        status: 'active',
      })
      .select('id')
      .single();

    if (error) throw new InternalServerErrorException(error.message);
    return created.id;
  }
}
