import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PostgrestError } from '@supabase/supabase-js';
import { SupabaseService } from 'src/supabase/supabase.service';

interface ProgramOwners {
  user_id: string | null;
}

/**
 * Centralized authorization checks. Every controller that takes a target
 * user/program/day/log ID from the request must verify the requester is
 * allowed to touch it via one of these helpers.
 */
@Injectable()
export class AccessService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get supabase() {
    return this.supabaseService.getClient();
  }

  assertSelf(requesterId: string, targetUserId: string): void {
    if (requesterId !== targetUserId) {
      throw new ForbiddenException('You can only access your own data');
    }
  }

  /** True when an approved coach-user relation exists. */
  async isCoachOf(coachId: string, userId: string): Promise<boolean> {
    if (!coachId || !userId || coachId === userId) return false;

    const { data: relation } = await this.supabase
      .from('coach_user_relations')
      .select('id')
      .eq('coach_id', coachId)
      .eq('user_id', userId)
      .eq('status', 'approved')
      .limit(1)
      .maybeSingle();

    return relation !== null;
  }

  /**
   * Every coach holding an approved relation to this user.
   *
   * Cache entries are keyed by *requester* (see `UserScopedCacheInterceptor`),
   * so invalidating a user's data means clearing the copy each of their
   * coaches may be holding too, not just the user's own.
   */
  async getApprovedCoachIds(userId: string): Promise<string[]> {
    if (!userId) return [];

    const { data, error } = await this.supabase
      .from('coach_user_relations')
      .select('coach_id')
      .eq('user_id', userId)
      .eq('status', 'approved')
      .returns<{ coach_id: string | null }[]>();

    if (error) {
      // The write this follows has already succeeded; failing the request over
      // a cache sweep would be worse than a coach seeing a stale minute.
      console.error('Failed to list approved coaches:', error);
      return [];
    }

    return (data ?? [])
      .map((row) => row.coach_id)
      .filter((id): id is string => !!id);
  }

  async assertSelfOrCoach(
    requesterId: string,
    targetUserId: string,
  ): Promise<void> {
    if (requesterId === targetUserId) return;
    if (await this.isCoachOf(requesterId, targetUserId)) return;
    throw new ForbiddenException('Not allowed to access this user');
  }

  async assertCoachRole(userId: string): Promise<void> {
    const { data } = await this.supabase
      .from('user')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    if (data?.role !== 'coach') {
      throw new ForbiddenException('Coach role required');
    }
  }

  /** Assert the requester owns the given coach workout plan (template). */
  async assertPlanOwner(requesterId: string, planId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('coach_workout_plans')
      .select('coach_id')
      .eq('id', planId)
      .maybeSingle();

    this.failOnQueryError(error);
    if (!data) throw new NotFoundException('Plan not found');
    if (data.coach_id !== requesterId) {
      throw new ForbiddenException('You do not own this plan');
    }
  }

  /** Assert the requester owns the given program preset (a week template). */
  async assertPresetOwner(
    requesterId: string,
    presetId: string,
  ): Promise<void> {
    const { data, error } = await this.supabase
      .from('coach_program_presets')
      .select('coach_id')
      .eq('id', presetId)
      .maybeSingle();

    this.failOnQueryError(error);
    if (!data) throw new NotFoundException('Preset not found');
    if (data.coach_id !== requesterId) {
      throw new ForbiddenException('You do not own this preset');
    }
  }

  private async assertOwners(
    requesterId: string,
    owners: ProgramOwners | null | undefined,
  ): Promise<void> {
    if (!owners) throw new NotFoundException('Resource not found');
    if (requesterId === owners.user_id) {
      return;
    }
    if (owners.user_id && (await this.isCoachOf(requesterId, owners.user_id))) {
      return;
    }
    throw new ForbiddenException('Not allowed to access this resource');
  }

  // A failed query must not be mistaken for a missing row (404).
  private failOnQueryError(error: PostgrestError | null): void {
    if (error) {
      console.error('Access check query failed:', error);
      throw new InternalServerErrorException('Access check failed');
    }
  }

  private unwrap<T>(value: T | T[] | null | undefined): T | null {
    if (!value) return null;
    return Array.isArray(value) ? (value[0] ?? null) : value;
  }

  async assertProgramAccess(
    requesterId: string,
    programId: string,
  ): Promise<void> {
    const { data, error } = await this.supabase
      .from('user_workout_programs')
      .select('user_id')
      .eq('id', programId)
      .maybeSingle();

    this.failOnQueryError(error);
    await this.assertOwners(requesterId, data);
  }

  async assertDayAccess(requesterId: string, dayId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('user_program_days')
      .select('user_workout_programs!inner(user_id)')
      .eq('id', dayId)
      .maybeSingle();

    this.failOnQueryError(error);
    await this.assertOwners(
      requesterId,
      this.unwrap(
        data?.['user_workout_programs'] as ProgramOwners | ProgramOwners[],
      ),
    );
  }

  async assertAssignedExerciseAccess(
    requesterId: string,
    assignedExerciseId: string,
  ): Promise<void> {
    const { data, error } = await this.supabase
      .from('user_assigned_exercises')
      .select(
        'user_program_days!inner(user_workout_programs!inner(user_id))',
      )
      .eq('id', assignedExerciseId)
      .maybeSingle();

    this.failOnQueryError(error);
    const day = this.unwrap(
      data?.['user_program_days'] as
        | Record<string, unknown>
        | Record<string, unknown>[],
    );
    await this.assertOwners(
      requesterId,
      this.unwrap(
        day?.['user_workout_programs'] as ProgramOwners | ProgramOwners[],
      ),
    );
  }

  async assertWorkoutLogAccess(
    requesterId: string,
    workoutLogId: string,
  ): Promise<void> {
    const { data, error } = await this.supabase
      .from('workout_logs')
      .select('coach_id, user_workout_programs!inner(user_id)')
      .eq('id', workoutLogId)
      .maybeSingle();

    this.failOnQueryError(error);
    if (data?.coach_id === requesterId) return;
    await this.assertOwners(
      requesterId,
      this.unwrap(
        data?.['user_workout_programs'] as ProgramOwners | ProgramOwners[],
      ),
    );
  }
}
