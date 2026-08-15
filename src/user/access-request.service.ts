import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { UserService } from './user.service';
import { CoachDataScope } from './consent.constants';
import { AccessRequestView } from './dto/access-request.dto';

/**
 * How long a coach must wait before asking again for a scope the client
 * declined. Long enough that "no" is respected, short enough that a change of
 * mind months later can still be revisited.
 */
const DECLINE_COOLDOWN_DAYS = 30;

/** Human-readable scope names for the notification body. */
const SCOPE_LABEL: Record<CoachDataScope, string> = {
  workouts: 'workouts',
  nutrition: 'meals',
  bodyMetrics: 'body metrics',
};

interface RequestRow {
  id: string;
  coach_id: string;
  client_id: string;
  scope: CoachDataScope;
  status: string;
  created_at: string;
  resolved_at: string | null;
}

/**
 * Coach-to-client requests to unlock a data scope.
 *
 * Deliberately separate from the consent ledger. A request is a prompt; the
 * answer is a consent decision, and only `UserService.saveConsents` writes
 * those. Keeping the two apart means this table can be edited, expired and
 * cleaned up freely without touching the append-only record that has to stand
 * up as evidence.
 */
@Injectable()
export class AccessRequestService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly notificationsService: NotificationsService,
    private readonly userService: UserService,
  ) {}

  private get supabase() {
    return this.supabaseService.supabase;
  }

  /**
   * Coach asks a client to share one scope.
   *
   * The caller must already have established that this coach is connected to
   * this client — see `AccessService.assertSelfOrCoach` in the controller.
   */
  async createRequest(
    coachId: string,
    clientId: string,
    scope: CoachDataScope,
  ): Promise<{ status: 'created' | 'pending'; id: string }> {
    // Nothing to ask for. Not an error the coach caused, but answering 409
    // rather than sending a pointless notification is the honest reply.
    const access = await this.userService.getCoachDataAccess(clientId);
    if (access[scope]) {
      throw new ConflictException('This client already shares that with you');
    }

    await this.expireStaleRequests(coachId, clientId, scope);

    const blockedUntil = await this.cooldownUntil(coachId, clientId, scope);
    if (blockedUntil) {
      throw new HttpException(
        `This client declined that request. You can ask again after ${blockedUntil.toISOString().slice(0, 10)}.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const { data, error } = await this.supabase
      .from('coach_access_requests')
      .insert({ coach_id: coachId, client_id: clientId, scope })
      .select('id')
      .single();

    if (error) {
      // 23505 is the partial unique index: an open request already exists.
      // That is the rate limit working, so report it as success rather than
      // failure — the coach's intent is already recorded, and re-notifying
      // would be exactly the nagging the index exists to prevent.
      if (error.code === '23505') {
        const existing = await this.findPending(coachId, clientId, scope);
        if (existing) return { status: 'pending', id: existing.id };
      }
      throw new InternalServerErrorException(
        `Error creating access request: ${error.message}`,
      );
    }

    await this.notifyClient(coachId, clientId, scope);
    return { status: 'created', id: (data as { id: string }).id };
  }

  /** Requests awaiting this user's answer. */
  async listPendingForUser(userId: string): Promise<AccessRequestView[]> {
    const { data, error } = await this.supabase
      .from('coach_access_requests')
      .select('id, coach_id, scope, created_at')
      .eq('client_id', userId)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      throw new InternalServerErrorException(
        `Error fetching access requests: ${error.message}`,
      );
    }

    const rows = (data ?? []) as Pick<
      RequestRow,
      'id' | 'coach_id' | 'scope' | 'created_at'
    >[];
    if (rows.length === 0) return [];

    // Resolved with a second query rather than a PostgREST embed: this table
    // has two foreign keys into "user", so an embed would need a disambiguating
    // constraint hint that breaks the moment a constraint is renamed.
    const names = await this.displayNames([
      ...new Set(rows.map((row) => row.coach_id)),
    ]);

    return rows.map((row) => ({
      id: row.id,
      coachId: row.coach_id,
      coachName: names.get(row.coach_id) ?? 'Your coach',
      scope: row.scope,
      createdAt: row.created_at,
    }));
  }

  /**
   * Client answers a request.
   *
   * This only records the outcome. The consent itself is written by the app
   * through `PUT /userController/user/:id/consents`, so the ledger keeps a
   * single writer. If that call fails while this one succeeds, the app's
   * pending-sync retry closes the gap on its next start.
   */
  async resolveRequest(
    userId: string,
    requestId: string,
    granted: boolean,
  ): Promise<{ message: string }> {
    const { data, error } = await this.supabase
      .from('coach_access_requests')
      .select('id, coach_id, client_id, scope, status')
      .eq('id', requestId)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(
        `Error loading access request: ${error.message}`,
      );
    }

    const request = data as Pick<
      RequestRow,
      'id' | 'coach_id' | 'client_id' | 'scope' | 'status'
    > | null;

    // Same answer for "no such request" and "not yours": whether a given
    // request id exists is not something a stranger should be able to probe.
    if (!request || request.client_id !== userId) {
      throw new NotFoundException('Access request not found');
    }

    // Already answered — treat as done rather than erroring, so a retried tap
    // on a flaky connection does not look like a failure.
    if (request.status !== 'pending') {
      return { message: `Request already ${request.status}` };
    }

    const { error: updateError } = await this.supabase
      .from('coach_access_requests')
      .update({
        status: granted ? 'granted' : 'declined',
        resolved_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .eq('status', 'pending');

    if (updateError) {
      throw new InternalServerErrorException(
        `Error resolving access request: ${updateError.message}`,
      );
    }

    await this.notifyCoachOfAnswer(
      request.coach_id,
      userId,
      request.scope,
      granted,
    );

    return { message: granted ? 'Access granted' : 'Request declined' };
  }

  /**
   * Closes requests nobody answered in time, so the partial unique index does
   * not keep an abandoned row blocking every future ask.
   */
  private async expireStaleRequests(
    coachId: string,
    clientId: string,
    scope: CoachDataScope,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('coach_access_requests')
      .update({ status: 'expired', resolved_at: new Date().toISOString() })
      .eq('coach_id', coachId)
      .eq('client_id', clientId)
      .eq('scope', scope)
      .eq('status', 'pending')
      .lte('expires_at', new Date().toISOString());

    if (error) {
      throw new InternalServerErrorException(
        `Error expiring access requests: ${error.message}`,
      );
    }
  }

  /** When a recent decline blocks another ask, or null if it does not. */
  private async cooldownUntil(
    coachId: string,
    clientId: string,
    scope: CoachDataScope,
  ): Promise<Date | null> {
    const since = new Date(
      Date.now() - DECLINE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { data, error } = await this.supabase
      .from('coach_access_requests')
      .select('resolved_at')
      .eq('coach_id', coachId)
      .eq('client_id', clientId)
      .eq('scope', scope)
      .eq('status', 'declined')
      .gte('resolved_at', since)
      .order('resolved_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(
        `Error checking request cooldown: ${error.message}`,
      );
    }

    const row = data as { resolved_at: string } | null;
    if (!row?.resolved_at) return null;

    return new Date(
      new Date(row.resolved_at).getTime() +
        DECLINE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000,
    );
  }

  private async findPending(
    coachId: string,
    clientId: string,
    scope: CoachDataScope,
  ): Promise<{ id: string } | null> {
    const { data } = await this.supabase
      .from('coach_access_requests')
      .select('id')
      .eq('coach_id', coachId)
      .eq('client_id', clientId)
      .eq('scope', scope)
      .eq('status', 'pending')
      .maybeSingle();

    return (data as { id: string } | null) ?? null;
  }

  private async displayNames(
    ids: string[],
    fallback = 'Your coach',
  ): Promise<Map<string, string>> {
    const { data, error } = await this.supabase
      .from('user')
      .select('id, first_name, last_name')
      .in('id', ids);

    if (error) {
      throw new InternalServerErrorException(
        `Error fetching names: ${error.message}`,
      );
    }

    const rows = (data ?? []) as {
      id: string;
      first_name: string | null;
      last_name: string | null;
    }[];

    return new Map(
      rows.map((row) => [
        row.id,
        [row.first_name, row.last_name].filter(Boolean).join(' ').trim() ||
          fallback,
      ]),
    );
  }

  /**
   * Tells the coach how their request was answered.
   *
   * A coach who asked and then hears nothing has no way to tell "declined"
   * from "the feature is broken", and would keep checking a screen that will
   * not change. Both outcomes are reported, the decline neutrally: it is an
   * answer the client is entitled to give.
   *
   * Note what does *not* notify: a client silently withdrawing a scope in
   * Settings. Nobody asked them anything there, and pushing "your client just
   * revoked your access" invites exactly the follow-up conversation the
   * cooldown on re-asking exists to prevent. The coach sees the lock next time
   * they look, which is enough.
   */
  private async notifyCoachOfAnswer(
    coachId: string,
    clientId: string,
    scope: CoachDataScope,
    granted: boolean,
  ): Promise<void> {
    // Already committed — nothing here may throw.
    let clientName = 'Your client';
    let firstName = '';
    let lastName = '';
    try {
      const { data } = await this.supabase
        .from('user')
        .select('first_name, last_name')
        .eq('id', clientId)
        .maybeSingle();

      const row = data as {
        first_name: string | null;
        last_name: string | null;
      } | null;

      firstName = row?.first_name ?? '';
      lastName = row?.last_name ?? '';
      clientName =
        [firstName, lastName].filter(Boolean).join(' ').trim() || clientName;
    } catch {
      // Generic name still makes the message readable.
    }

    this.notificationsService.notifyUser(coachId, {
      title: granted ? 'Request accepted' : 'Request declined',
      body: granted
        ? `${clientName} now shares their ${SCOPE_LABEL[scope]} with you.`
        : `${clientName} chose not to share their ${SCOPE_LABEL[scope]} for now.`,
      // Enough for the app to open the client, matching the shape the existing
      // workout_completed notification already uses.
      data: {
        type: 'coach_access_answer',
        clientId,
        firstName,
        lastName,
      },
    });
  }

  private async notifyClient(
    coachId: string,
    clientId: string,
    scope: CoachDataScope,
  ): Promise<void> {
    // The request row is already committed by this point, so nothing in here
    // may throw: failing the response would tell the coach the ask did not
    // happen when it did, and their retry would hit the duplicate index.
    let coachName = 'Your coach';
    try {
      coachName =
        (await this.displayNames([coachId])).get(coachId) ?? coachName;
    } catch {
      // Fall back to the generic name; the prompt still makes sense.
    }

    // Fire-and-forget: a dead push token must not fail the request. The client
    // still sees the ask on the home screen next time they open the app.
    //
    // `data` carries only the type because that is all the app needs — every
    // scope opens the same screen. The body does name the scope: a prompt that
    // will not say what is being asked for is not worth sending.
    this.notificationsService.notifyUser(clientId, {
      title: 'Sharing request',
      body: `${coachName} would like to see your ${SCOPE_LABEL[scope]}.`,
      data: { type: 'coach_access_request' },
    });
  }
}
