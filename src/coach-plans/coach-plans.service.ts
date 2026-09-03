import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import {
  AssignPresetDto,
  CreatePresetDto,
  PresetDayDto,
  UpdatePresetDto,
} from './dto/coach-preset.dto';

// A preset slot as it comes back from `getPreset`.
interface PresetDayRow {
  id: string;
  plan_id: string;
  day_number: number;
  week_number: number;
  day_name: string | null;
}

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

  // Copy a plan into a student's program as a new day on the given slot
  // (day_number 1–7 for a weekday, 8 and up for a bonus day). Snapshot: the
  // copied day is independent of the template from this point on;
  // source_plan_id is stored as provenance only.
  // Authorization (coach owns plan AND coaches this student) is enforced in the
  // controller via AccessService before this runs.
  async assignPlanToStudent(
    coachId: string,
    planId: string,
    dto: AssignPlanDto,
  ) {
    const plan = await this.getPlan(planId);
    const programId = await this.resolveTargetProgram(coachId, dto);

    // One day per slot: the calendar renders a single day per chip, so a second
    // row on the same slot would be inaccessible. An extra session goes on a
    // bonus slot of its own, not on top of an occupied one.
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
        'This day already has a workout in the program',
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
  // PROGRAM PRESETS (COACH)
  // ============================================
  //
  // A preset is a reusable training *week*: which day plan sits on which
  // weekday. It stores references, not copies — editing a day plan changes
  // every preset that uses it — while assigning a preset to a student copies
  // the exercises, exactly as assigning a single day plan does.

  async createPreset(coachId: string, dto: CreatePresetDto) {
    const { days, ...presetData } = dto;
    this.assertSlotsAreUnique(days);
    await this.assertPlansOwnedByCoach(
      coachId,
      days.map((day) => day.plan_id),
    );

    const { data: preset, error } = await this.supabase
      .from('coach_program_presets')
      .insert({ ...presetData, coach_id: coachId })
      .select()
      .single();

    if (error) throw new InternalServerErrorException(error.message);

    if (days.length) {
      const { error: daysError } = await this.supabase
        .from('coach_program_preset_days')
        .insert(this.presetDayRows(preset.id, days));

      if (daysError) {
        // Roll back the header so a half-created preset never survives.
        await this.supabase
          .from('coach_program_presets')
          .delete()
          .eq('id', preset.id);
        throw new InternalServerErrorException(daysError.message);
      }
    }

    return this.getPreset(preset.id);
  }

  // All presets owned by a coach, with slot counts for list views.
  async listPresets(coachId: string) {
    const { data, error } = await this.supabase
      .from('coach_program_presets')
      .select('*, coach_program_preset_days (count)')
      .eq('coach_id', coachId)
      .order('created_at', { ascending: false });

    if (error) throw new InternalServerErrorException(error.message);
    return data;
  }

  // One preset with its slots, each resolved to the day plan it points at.
  async getPreset(presetId: string) {
    const { data, error } = await this.supabase
      .from('coach_program_presets')
      .select(
        `
        *,
        coach_program_preset_days (
          *,
          coach_workout_plans (
            id,
            name,
            description,
            coach_workout_plan_exercises ( count )
          )
        )
      `,
      )
      .eq('id', presetId)
      .single();

    if (error) throw new NotFoundException('Preset not found');
    return this.sortPresetDays(data);
  }

  async updatePreset(coachId: string, presetId: string, dto: UpdatePresetDto) {
    const { days, ...meta } = dto;

    if (Object.keys(meta).length > 0) {
      const { error } = await this.supabase
        .from('coach_program_presets')
        .update({ ...meta, updated_at: new Date().toISOString() })
        .eq('id', presetId);
      if (error) throw new InternalServerErrorException(error.message);
    }

    // Present but empty is a deliberate "clear the week", so the check is on
    // undefined rather than on length.
    if (days !== undefined) {
      this.assertSlotsAreUnique(days);
      await this.assertPlansOwnedByCoach(
        coachId,
        days.map((day) => day.plan_id),
      );

      const { error: delError } = await this.supabase
        .from('coach_program_preset_days')
        .delete()
        .eq('preset_id', presetId);
      if (delError) throw new InternalServerErrorException(delError.message);

      if (days.length) {
        const { error: insError } = await this.supabase
          .from('coach_program_preset_days')
          .insert(this.presetDayRows(presetId, days));
        if (insError) throw new InternalServerErrorException(insError.message);
      }
    }

    return this.getPreset(presetId);
  }

  // Delete a preset. Its slots cascade; the day plans they referenced are
  // untouched, and so is any week already assigned to a student.
  async deletePreset(presetId: string) {
    const { error } = await this.supabase
      .from('coach_program_presets')
      .delete()
      .eq('id', presetId);

    if (error) throw new InternalServerErrorException(error.message);
    return { message: 'Preset deleted successfully' };
  }

  /**
   * Copy every day plan in a preset into a student's program.
   *
   * All-or-nothing: a slot that fails to copy takes the days written before it
   * with it, so the coach never lands on half a week. An occupied weekday is a
   * 409 carrying the days in the way, unless `replace_existing` says to
   * overwrite them.
   */
  async assignPresetToStudent(
    coachId: string,
    presetId: string,
    dto: AssignPresetDto,
  ) {
    const preset = await this.getPreset(presetId);
    const slots = (preset.coach_program_preset_days ?? []) as PresetDayRow[];

    if (slots.length === 0) {
      throw new BadRequestException('This preset has no days to assign');
    }

    const programId = await this.resolveTargetProgram(coachId, dto);

    const { data: existing, error: existingError } = await this.supabase
      .from('user_program_days')
      .select('id, day_number')
      .eq('program_id', programId)
      .in(
        'day_number',
        slots.map((slot) => slot.day_number),
      );

    if (existingError) {
      throw new InternalServerErrorException(existingError.message);
    }

    const occupied = existing ?? [];
    if (occupied.length > 0 && !dto.replace_existing) {
      throw new ConflictException({
        message: 'Some weekdays already have a workout in this program',
        occupied_days: occupied.map((day) => day.day_number),
      });
    }

    if (occupied.length > 0) {
      // Their logged sessions go with them — the app confirms before asking
      // for this.
      const { error: delError } = await this.supabase
        .from('user_program_days')
        .delete()
        .in(
          'id',
          occupied.map((day) => day.id),
        );
      if (delError) throw new InternalServerErrorException(delError.message);
    }

    const createdDayIds: string[] = [];
    try {
      for (const slot of slots) {
        const plan = this.unwrapPlan(slot);

        const { data: day, error: dayError } = await this.supabase
          .from('user_program_days')
          .insert({
            program_id: programId,
            source_plan_id: slot.plan_id,
            week_number: slot.week_number ?? 1,
            day_number: slot.day_number,
            day_name: slot.day_name ?? plan?.name ?? null,
            notes: null,
          })
          .select('id')
          .single();

        if (dayError) throw new InternalServerErrorException(dayError.message);

        createdDayIds.push(day.id);
        await this.copyPlanExercisesToDay(slot.plan_id, day.id);
      }
    } catch (err) {
      if (createdDayIds.length) {
        await this.supabase
          .from('user_program_days')
          .delete()
          .in('id', createdDayIds);
      }
      throw err;
    }

    this.notificationsService.notifyUser(dto.user_id, {
      title: 'New Training Week',
      body: `Your coach set up "${preset.name}" for you.`,
    });

    return {
      program_id: programId,
      created_days: createdDayIds.length,
      replaced_days: occupied.length,
    };
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

  // Two workouts on one weekday cannot both be rendered by the recurring-week
  // calendar. The unique index enforces it too; this turns that into a 400 the
  // app can show rather than a database error.
  private assertSlotsAreUnique(days: PresetDayDto[]) {
    const seen = new Set<string>();
    for (const day of days) {
      const key = `${day.week_number ?? 1}-${day.day_number}`;
      if (seen.has(key)) {
        throw new BadRequestException(
          `Weekday ${day.day_number} is used twice in this preset`,
        );
      }
      seen.add(key);
    }
  }

  // A preset may only point at day plans the coach owns: assigning one copies
  // its exercises, so an unchecked id would read another coach's template.
  private async assertPlansOwnedByCoach(coachId: string, planIds: string[]) {
    const unique = [...new Set(planIds)];
    if (unique.length === 0) return;

    const { data, error } = await this.supabase
      .from('coach_workout_plans')
      .select('id')
      .eq('coach_id', coachId)
      .in('id', unique);

    if (error) throw new InternalServerErrorException(error.message);
    if ((data?.length ?? 0) !== unique.length) {
      throw new ForbiddenException(
        'A day plan in this preset does not belong to you',
      );
    }
  }

  private presetDayRows(presetId: string, days: PresetDayDto[]) {
    return days.map((day) => ({
      preset_id: presetId,
      plan_id: day.plan_id,
      day_number: day.day_number,
      week_number: day.week_number ?? 1,
      day_name: day.day_name ?? null,
    }));
  }

  // PostgREST returns embedded rows in whatever order Postgres hands back, so
  // the week is ordered here — every reader shows Monday first.
  private sortPresetDays<T extends Record<string, any>>(preset: T): T {
    const days = preset?.coach_program_preset_days;
    if (!Array.isArray(days)) return preset;

    return {
      ...preset,
      coach_program_preset_days: [...days].sort(
        (a, b) =>
          (a.week_number ?? 1) - (b.week_number ?? 1) ||
          (a.day_number ?? 0) - (b.day_number ?? 0),
      ),
    };
  }

  // The embedded plan arrives as a row or a single-element array, depending on
  // how PostgREST resolves the relation.
  private unwrapPlan(slot: Record<string, any>): { name?: string } | null {
    const plan = slot?.['coach_workout_plans'] as
      | Record<string, any>
      | Record<string, any>[]
      | null;
    if (!plan) return null;
    return Array.isArray(plan) ? (plan[0] ?? null) : plan;
  }

  // Pick the program to attach the day to: explicit id, else the student's
  // active program, else create a fresh one.
  private async resolveTargetProgram(
    coachId: string,
    dto: { user_id: string; program_id?: string },
  ): Promise<string> {
    if (dto.program_id) {
      // The caller names the program, so it has to be checked against the
      // student the assignment was authorized for — otherwise any program id
      // a coach happens to know could be written into.
      const { data: target, error } = await this.supabase
        .from('user_workout_programs')
        .select('id, user_id')
        .eq('id', dto.program_id)
        .maybeSingle();

      if (error) throw new InternalServerErrorException(error.message);
      if (!target) throw new NotFoundException('Program not found');
      if (target.user_id !== dto.user_id) {
        throw new ForbiddenException(
          'That program does not belong to this student',
        );
      }
      return target.id;
    }

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
