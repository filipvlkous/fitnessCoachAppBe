import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PostgrestError } from '@supabase/supabase-js';
import { SupabaseService } from 'src/supabase/supabase.service';
import {
  COACH_DATA_SCOPES,
  COACH_SCOPE_KIND,
  CoachDataScope,
  CONSENT_KIND,
  ConsentKey,
} from 'src/user/consent.constants';

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

  /**
   * Every user this coach holds an approved relation to.
   *
   * The mirror image of `getApprovedCoachIds`, and needed for the same reason:
   * cache entries are keyed by *reader*, so a coach changing something their
   * clients read means clearing the copy each client may be holding.
   */
  async getApprovedClientIds(coachId: string): Promise<string[]> {
    if (!coachId) return [];

    const { data, error } = await this.supabase
      .from('coach_user_relations')
      .select('user_id')
      .eq('coach_id', coachId)
      .eq('status', 'approved')
      .returns<{ user_id: string | null }[]>();

    if (error) {
      // Same trade as above: the write this follows has already succeeded, and
      // failing it over a cache sweep would be worse than a stale minute.
      console.error('Failed to list approved clients:', error);
      return [];
    }

    return (data ?? [])
      .map((row) => row.user_id)
      .filter((id): id is string => !!id);
  }

  /**
   * The user themselves, or a coach of theirs. Pass `scope` when the route
   * returns data the client shares only by choice: a coach then also needs
   * that scope granted. The user is never limited by their own scopes.
   */
  async assertSelfOrCoach(
    requesterId: string,
    targetUserId: string,
    scope?: CoachDataScope,
  ): Promise<void> {
    if (requesterId === targetUserId) return;
    if (await this.isCoachOf(requesterId, targetUserId)) {
      if (scope) await this.assertCoachScope(targetUserId, scope);
      return;
    }
    throw new ForbiddenException('Not allowed to access this user');
  }

  /**
   * What a connected coach may actually read about this user, per scope.
   *
   * This is the ANDing the ledger deliberately does not do: a `coachScope` row
   * only means something while the `coachSharing` consent is standing, so
   * withdrawing that one consent closes every scope at once without having to
   * rewrite the individual scope decisions.
   *
   * Fails closed on every unknown: a scope with no recorded decision, a user who
   * never went through the consent screen, or a missing `coachSharing` row all
   * come back false. Silence is not permission.
   */
  async getCoachDataAccess(
    userId: string,
  ): Promise<Record<CoachDataScope, boolean>> {
    const denied = Object.fromEntries(
      COACH_DATA_SCOPES.map((scope) => [scope, false]),
    ) as Record<CoachDataScope, boolean>;

    const { data, error } = await this.supabase
      .from('user_consents_current')
      .select('kind, consent_key, granted')
      .eq('user_id', userId);

    if (error) {
      throw new InternalServerErrorException(
        `Error fetching coach permissions: ${error.message}`,
      );
    }

    const rows = (data ?? []) as {
      kind: string;
      consent_key: string;
      granted: boolean;
    }[];

    const sharing = rows.some(
      (row) =>
        row.kind === CONSENT_KIND &&
        row.consent_key === ('coachSharing' satisfies ConsentKey) &&
        row.granted,
    );
    if (!sharing) return denied;

    for (const row of rows) {
      if (row.kind !== COACH_SCOPE_KIND) continue;
      const scope = row.consent_key as CoachDataScope;
      // Guard against a key the ledger holds but this build does not know.
      if (scope in denied) denied[scope] = row.granted;
    }

    return denied;
  }

  /** Throws unless the client currently shares `scope` with their coach. */
  async assertCoachScope(
    clientId: string,
    scope: CoachDataScope,
  ): Promise<void> {
    const access = await this.getCoachDataAccess(clientId);
    if (!access[scope]) {
      throw new ForbiddenException(`Client does not share ${scope}`);
    }
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
    scope?: CoachDataScope,
  ): Promise<void> {
    if (!owners) throw new NotFoundException('Resource not found');
    if (requesterId === owners.user_id) {
      return;
    }
    if (owners.user_id && (await this.isCoachOf(requesterId, owners.user_id))) {
      if (scope) await this.assertCoachScope(owners.user_id, scope);
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
    scope?: CoachDataScope,
  ): Promise<void> {
    const { data, error } = await this.supabase
      .from('user_workout_programs')
      .select('user_id')
      .eq('id', programId)
      .maybeSingle();

    this.failOnQueryError(error);
    await this.assertOwners(requesterId, data, scope);
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
      .select('user_program_days!inner(user_workout_programs!inner(user_id))')
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
    scope?: CoachDataScope,
  ): Promise<void> {
    const { data, error } = await this.supabase
      .from('workout_logs')
      .select('coach_id, user_workout_programs!inner(user_id)')
      .eq('id', workoutLogId)
      .maybeSingle();

    this.failOnQueryError(error);
    const owners = this.unwrap(
      data?.['user_workout_programs'] as ProgramOwners | ProgramOwners[],
    );
    if (data?.coach_id === requesterId) {
      // Being the log's coach does not outrank the client's own sharing choice.
      if (scope && owners?.user_id && owners.user_id !== requesterId) {
        await this.assertCoachScope(owners.user_id, scope);
      }
      return;
    }
    await this.assertOwners(requesterId, owners, scope);
  }
}
