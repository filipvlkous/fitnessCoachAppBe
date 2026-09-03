import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseService } from 'src/supabase/supabase.service';
import { AccessService } from 'src/auth/access.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import {
  CreateMeetingDto,
  MeetingStatus,
  MeetingView,
  RespondMeetingDto,
} from './dto/meeting.dto';
import { COACH_TZ } from './dto/availability.dto';

interface MeetingRow {
  id: string;
  coach_id: string;
  client_id: string;
  starts_at: string;
  proposed_starts_at: string | null;
  duration_minutes: number;
  service: string | null;
  location: string | null;
  note: string | null;
  status: MeetingStatus;
  decline_reason: string | null;
  cancelled_by: string | null;
  reminded_at: string | null;
  created_at: string;
}

const DEFAULT_DURATION_MINUTES = 60;

/**
 * A booking further out than this is more likely a mis-set year on the picker
 * than a real plan, and it would sit in the one-open-request slot until
 * someone noticed.
 */
const MAX_LEAD_DAYS = 180;

/**
 * How long a declined meeting keeps showing so the other side actually learns
 * the answer.
 *
 * A day, not a week: these cards have no dismiss action, and an undismissable
 * "your request was declined" sitting on the home screen stops being
 * information and starts being nagging. One day covers someone who missed the
 * push and opens the app the next morning.
 *
 * A *cancellation* gets no card at all — see `listForUser`.
 */
const DECLINE_VISIBLE_HOURS = 24;

/**
 * How far ahead of a session its reminder goes out.
 *
 * The job ticks hourly, so the push lands one to two hours before the slot.
 * That is deliberately loose: a training session is not something you need
 * warned about to the minute, and an afternoon is still yours to rearrange an
 * hour out. A minute-accurate reminder would mean running the job sixty times
 * as often for a difference nobody would notice.
 */
const REMINDER_LEAD_MINUTES = 120;

/**
 * In-person training sessions between a coach and their client.
 *
 * The client asks; the coach approves, declines, or puts a different time
 * back. Which of the two may act is derived from the status alone — `pending`
 * is the coach's turn, `proposed` is the client's — so neither app can put
 * itself in a state the other side has to untangle.
 */
@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly accessService: AccessService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private get supabase() {
    return this.supabaseService.supabase;
  }

  /** Client asks their coach for a slot. */
  async createRequest(
    clientId: string,
    dto: CreateMeetingDto,
  ): Promise<MeetingView> {
    const coachId = await this.resolveCoach(clientId, dto.coachId);
    const startsAt = this.parseFutureTime(dto.startsAt);

    const { data, error } = await this.supabase
      .from('gym_meetings')
      .insert({
        coach_id: coachId,
        client_id: clientId,
        starts_at: startsAt.toISOString(),
        duration_minutes: dto.durationMinutes ?? DEFAULT_DURATION_MINUTES,
        service: dto.service ?? null,
        location: dto.location ?? (await this.coachGym(coachId)),
        note: dto.note ?? null,
      })
      .select('*')
      .single<MeetingRow>();

    if (error) {
      // 23505 is the partial unique index: this pair already has an open
      // negotiation. Reported rather than swallowed — unlike an access
      // request, the client picked a specific time here, and silently
      // returning the older row would show them a slot they did not choose.
      if (error.code === '23505') {
        throw new ConflictException(
          'You already have a meeting request waiting to be answered.',
        );
      }
      throw new InternalServerErrorException(
        `Error creating meeting request: ${error.message}`,
      );
    }

    const row = data;
    await this.notifyOfRequest(row);
    return this.toView(row, clientId, await this.peerName(coachId));
  }

  /**
   * Meetings either side needs to see: everything still open, everything
   * approved that has not happened yet, and recent declines so a "no" is not
   * invisible to whoever missed the push.
   *
   * Cancellations are deliberately absent. The other side is told by push the
   * moment it happens, and that is the whole message — a card that says a
   * meeting is *not* happening is an entry about nothing, sitting on the home
   * screen with no action on it and no way to dismiss it. The row stays in the
   * table as the record; it just has nothing left to say on screen.
   */
  async listForUser(userId: string): Promise<MeetingView[]> {
    const now = new Date();
    const declinedSince = new Date(
      now.getTime() - DECLINE_VISIBLE_HOURS * 60 * 60 * 1000,
    ).toISOString();

    // The second filter is what keeps availability windows out: they hold none
    // of these statuses, and the two `or` groups are ANDed together.
    const { data, error } = await this.supabase
      .from('gym_meetings')
      .select('*')
      .or(`coach_id.eq.${userId},client_id.eq.${userId}`)
      .or(
        [
          'status.in.(pending,proposed)',
          `and(status.eq.approved,starts_at.gte.${now.toISOString()})`,
          `and(status.eq.declined,resolved_at.gte.${declinedSince})`,
        ].join(','),
      )
      .order('starts_at', { ascending: true })
      .returns<MeetingRow[]>();

    if (error) {
      throw new InternalServerErrorException(
        `Error fetching meetings: ${error.message}`,
      );
    }

    const rows = data ?? [];
    if (rows.length === 0) return [];

    const names = await this.displayNames([
      ...new Set(
        rows.map((row) =>
          row.coach_id === userId ? row.client_id : row.coach_id,
        ),
      ),
    ]);

    return rows.map((row) => {
      const peerId = row.coach_id === userId ? row.client_id : row.coach_id;
      return this.toView(
        row,
        userId,
        names.get(peerId) ?? this.fallbackName(row, userId),
      );
    });
  }

  /**
   * Answer the meeting waiting on you.
   *
   * Whose turn it is comes from the status, not from the caller's role claim:
   * `pending` is the coach's to answer, `proposed` is the client's. A coach may
   * counter-propose; a client answering a counter-proposal may only take it or
   * leave it, which is what stops the two sides trading times forever.
   */
  async respond(
    userId: string,
    meetingId: string,
    dto: RespondMeetingDto,
  ): Promise<MeetingView> {
    const row = await this.loadForParty(meetingId, userId);

    // Already answered. Returned rather than thrown so a retried tap on a
    // flaky connection does not look like a failure.
    if (row.status !== 'pending' && row.status !== 'proposed') {
      return this.toView(row, userId, await this.peerNameFor(row, userId));
    }

    const responderId = row.status === 'pending' ? row.coach_id : row.client_id;
    if (userId !== responderId) {
      throw new ForbiddenException(
        'This meeting is waiting on the other side.',
      );
    }

    if (dto.action === 'propose' && row.status !== 'pending') {
      throw new BadRequestException(
        'A proposed time can only be accepted or declined.',
      );
    }

    const now = new Date().toISOString();
    const patch: Partial<MeetingRow> & {
      updated_at: string;
      resolved_at?: string;
    } = { updated_at: now };

    if (dto.action === 'approve') {
      patch.status = 'approved';
      patch.resolved_at = now;
      // Confirming a counter-offer is what makes it the real time.
      if (row.status === 'proposed' && row.proposed_starts_at) {
        patch.starts_at = row.proposed_starts_at;
        patch.proposed_starts_at = null;
      }
      const startsIn =
        new Date(patch.starts_at ?? row.starts_at).getTime() - Date.now();
      // An approval that lands after the slot has passed helps nobody, and it
      // would put a calendar entry in the past on both devices.
      if (startsIn <= 0) {
        throw new BadRequestException(
          'That time has already passed. Propose a new one instead.',
        );
      }
      // An approval this close to the slot *is* the reminder. Claiming the row
      // here is what stops the job pushing a second time about a session the
      // two sides agreed on twenty minutes ago.
      if (startsIn <= REMINDER_LEAD_MINUTES * 60 * 1000) {
        patch.reminded_at = now;
      }
    } else if (dto.action === 'decline') {
      patch.status = 'declined';
      patch.resolved_at = now;
      patch.decline_reason = dto.reason ?? null;
    } else {
      if (!dto.startsAt) {
        throw new BadRequestException('A proposed time is required.');
      }
      patch.status = 'proposed';
      patch.proposed_starts_at = this.parseFutureTime(
        dto.startsAt,
      ).toISOString();
    }

    const { data, error } = await this.supabase
      .from('gym_meetings')
      .update(patch)
      // Guards against two taps racing: the second finds nothing to update.
      .eq('id', meetingId)
      .eq('status', row.status)
      .select('*')
      .maybeSingle<MeetingRow>();

    if (error) {
      throw new InternalServerErrorException(
        `Error answering meeting: ${error.message}`,
      );
    }
    if (!data) {
      // Someone else moved it first. Report what it is now rather than failing.
      const current = await this.loadForParty(meetingId, userId);
      return this.toView(
        current,
        userId,
        await this.peerNameFor(current, userId),
      );
    }

    const updated = data;
    await this.notifyOfAnswer(updated, userId, dto.action);
    return this.toView(
      updated,
      userId,
      await this.peerNameFor(updated, userId),
    );
  }

  /** Either party calls off a meeting that has not happened yet. */
  async cancel(userId: string, meetingId: string): Promise<MeetingView> {
    const row = await this.loadForParty(meetingId, userId);

    if (row.status === 'cancelled' || row.status === 'declined') {
      return this.toView(row, userId, await this.peerNameFor(row, userId));
    }

    const now = new Date().toISOString();
    const { data, error } = await this.supabase
      .from('gym_meetings')
      .update({
        status: 'cancelled',
        cancelled_by: userId,
        resolved_at: now,
        updated_at: now,
      })
      .eq('id', meetingId)
      .in('status', ['pending', 'proposed', 'approved'])
      .select('*')
      .maybeSingle<MeetingRow>();

    if (error) {
      throw new InternalServerErrorException(
        `Error cancelling meeting: ${error.message}`,
      );
    }
    if (!data) {
      const current = await this.loadForParty(meetingId, userId);
      return this.toView(
        current,
        userId,
        await this.peerNameFor(current, userId),
      );
    }

    const updated = data;
    await this.notifyOfCancel(updated, userId);
    return this.toView(
      updated,
      userId,
      await this.peerNameFor(updated, userId),
    );
  }

  /**
   * Tells both sides about a session that is about to start.
   *
   * The only notification here that hangs off the clock rather than off
   * someone tapping something: between the approval and the session itself
   * nothing is said, and by then the approval push can be days old.
   *
   * Both parties get it, not just the client. A coach's day is made of these,
   * and the one who has five today is no more able to keep them all in their
   * head than the client with one.
   */
  @Cron('0 * * * *')
  async remindUpcoming(): Promise<void> {
    const now = new Date();
    const until = new Date(now.getTime() + REMINDER_LEAD_MINUTES * 60 * 1000);

    // Claimed and read in one statement. A select followed by an update would
    // leave a window in which a second instance — or the next tick, after a
    // slow run — reads the same rows and pushes again; `reminded_at is null`
    // inside the update means only one caller can ever come away with a row.
    const { data, error } = await this.supabase
      .from('gym_meetings')
      .update({ reminded_at: now.toISOString() })
      .eq('status', 'approved')
      .is('reminded_at', null)
      .gt('starts_at', now.toISOString())
      .lte('starts_at', until.toISOString())
      .select('*')
      .returns<MeetingRow[]>();

    if (error) {
      // Nothing is retried: the rows stayed unclaimed, so the next tick picks
      // up whatever is still inside the window.
      this.logger.error(`Meeting reminders failed: ${error.message}`);
      return;
    }

    const rows = data ?? [];
    if (rows.length === 0) return;

    let names = new Map<string, string>();
    try {
      names = await this.displayNames([
        ...new Set(rows.flatMap((row) => [row.coach_id, row.client_id])),
      ]);
    } catch {
      // Generic names still make the message readable.
    }

    for (const row of rows) {
      const slot = this.formatSlot(row.starts_at);
      const label = this.sessionLabel(row, 'Trénink');

      for (const recipientId of [row.coach_id, row.client_id]) {
        const isCoach = recipientId === row.coach_id;
        const peerId = isCoach ? row.client_id : row.coach_id;
        const peerName =
          names.get(peerId) ?? (isCoach ? 'klientem' : 'trenérem');

        this.notificationsService.notifyUser(recipientId, {
          title: 'Blíží se trénink',
          body: `${label} s ${peerName} začíná ${slot}.`,
          data: {
            type: 'meeting_reminder',
            meetingId: row.id,
            clientId: row.client_id,
          },
        });
      }
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /**
   * The coach this request is for. An explicit id is verified rather than
   * trusted: without the relation check this endpoint would let any account
   * push a notification at any other.
   */
  private async resolveCoach(
    clientId: string,
    explicitCoachId?: string,
  ): Promise<string> {
    if (explicitCoachId) {
      if (!(await this.accessService.isCoachOf(explicitCoachId, clientId))) {
        throw new ForbiddenException('This is not your coach.');
      }
      return explicitCoachId;
    }

    const { data } = await this.supabase
      .from('coach_user_relations')
      .select('coach_id')
      .eq('user_id', clientId)
      .eq('status', 'approved')
      .limit(1)
      .maybeSingle();

    const coachId = (data as { coach_id: string } | null)?.coach_id;
    if (!coachId) {
      throw new ForbiddenException('You do not have a coach yet.');
    }
    return coachId;
  }

  private parseFutureTime(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Invalid meeting time.');
    }
    if (date.getTime() <= Date.now()) {
      throw new BadRequestException('Pick a time in the future.');
    }
    if (date.getTime() > Date.now() + MAX_LEAD_DAYS * 24 * 60 * 60 * 1000) {
      throw new BadRequestException('That is too far in the future.');
    }
    return date;
  }

  /** The gym on the coach's profile, used when the app sends no location. */
  private async coachGym(coachId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('coach_profiles')
      .select('gym')
      .eq('coach_id', coachId)
      .maybeSingle();

    return (data as { gym: string | null } | null)?.gym ?? null;
  }

  private async loadForParty(
    meetingId: string,
    userId: string,
  ): Promise<MeetingRow> {
    const { data, error } = await this.supabase
      .from('gym_meetings')
      .select('*')
      .eq('id', meetingId)
      // The table also holds the coach's availability windows, which are not
      // meetings and have no answer to give. Excluded here rather than left to
      // the status checks below, so an id that names one reads as "no such
      // meeting" instead of quietly reaching the update paths.
      .neq('status', 'availability')
      .maybeSingle<MeetingRow>();

    if (error) {
      throw new InternalServerErrorException(
        `Error loading meeting: ${error.message}`,
      );
    }

    const row = data;
    // Same answer for "no such meeting" and "not yours": whether a given id
    // exists is not something a stranger should be able to probe.
    if (!row || (row.coach_id !== userId && row.client_id !== userId)) {
      throw new NotFoundException('Meeting not found');
    }
    return row;
  }

  private toView(
    row: MeetingRow,
    viewerId: string,
    peerName: string,
  ): MeetingView {
    const peerId = row.coach_id === viewerId ? row.client_id : row.coach_id;
    const responderId = row.status === 'pending' ? row.coach_id : row.client_id;

    return {
      id: row.id,
      coachId: row.coach_id,
      clientId: row.client_id,
      peerId,
      peerName,
      startsAt: row.starts_at,
      proposedStartsAt: row.proposed_starts_at,
      durationMinutes: row.duration_minutes,
      service: row.service,
      location: row.location,
      note: row.note,
      status: row.status,
      declineReason: row.decline_reason,
      cancelledBy: row.cancelled_by,
      createdAt: row.created_at,
      awaitingMe:
        (row.status === 'pending' || row.status === 'proposed') &&
        responderId === viewerId,
    };
  }

  private fallbackName(row: MeetingRow, viewerId: string): string {
    return row.coach_id === viewerId ? 'Your client' : 'Your coach';
  }

  private async peerNameFor(
    row: MeetingRow,
    viewerId: string,
  ): Promise<string> {
    const peerId = row.coach_id === viewerId ? row.client_id : row.coach_id;
    return (
      (await this.displayNames([peerId])).get(peerId) ??
      this.fallbackName(row, viewerId)
    );
  }

  private async peerName(userId: string): Promise<string> {
    return (await this.displayNames([userId])).get(userId) ?? 'Your coach';
  }

  private async displayNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();

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
      rows
        .map(
          (row) =>
            [
              row.id,
              [row.first_name, row.last_name].filter(Boolean).join(' ').trim(),
            ] as const,
        )
        .filter(([, name]) => name.length > 0),
    );
  }

  /** Local date+time, in the language the apps are written in. */
  private formatSlot(iso: string): string {
    return new Date(iso).toLocaleString('cs-CZ', {
      day: 'numeric',
      month: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: COACH_TZ,
    });
  }

  /**
   * What to call the session in a push.
   *
   * The service the client booked, when they booked one — "Osobní trénink
   * v úterý" tells the coach what they are being asked for, which a bare time
   * does not. The fallback is per call site rather than shared: the copy
   * around it differs, and Czech does not let one noun sit in all of them.
   */
  private sessionLabel(row: MeetingRow, fallback: string): string {
    return row.service?.trim() || fallback;
  }

  private async notifyOfRequest(row: MeetingRow): Promise<void> {
    // The row is already committed, so nothing here may throw: failing the
    // response would tell the client the ask did not happen when it did, and
    // their retry would hit the one-open-request index.
    let clientName = 'Your client';
    try {
      clientName =
        (await this.displayNames([row.client_id])).get(row.client_id) ??
        clientName;
    } catch {
      // Generic name still makes the message readable.
    }

    this.notificationsService.notifyUser(row.coach_id, {
      title: 'Nová žádost o schůzku',
      body: `${clientName} navrhuje ${this.sessionLabel(row, 'trénink')} ${this.formatSlot(row.starts_at)}.`,
      data: {
        type: 'meeting_request',
        meetingId: row.id,
        clientId: row.client_id,
      },
    });
  }

  private async notifyOfAnswer(
    row: MeetingRow,
    responderId: string,
    action: RespondMeetingDto['action'],
  ): Promise<void> {
    const recipientId =
      responderId === row.coach_id ? row.client_id : row.coach_id;

    let responderName = responderId === row.coach_id ? 'Trenér' : 'Klient';
    try {
      responderName =
        (await this.displayNames([responderId])).get(responderId) ??
        responderName;
    } catch {
      // Generic name still makes the message readable.
    }

    const slot = this.formatSlot(row.proposed_starts_at ?? row.starts_at);
    const session = this.sessionLabel(row, 'termín');
    const copy: Record<typeof action, { title: string; body: string }> = {
      approve: {
        title: 'Schůzka potvrzena',
        body: `${responderName} potvrdil ${session} ${slot}.`,
      },
      decline: {
        title: 'Schůzka zamítnuta',
        body: row.decline_reason
          ? `${responderName}: ${row.decline_reason}`
          : `${responderName} ${session} ${slot} nepřijal.`,
      },
      propose: {
        title: 'Navržen jiný termín',
        body: `${responderName} navrhuje ${slot}.`,
      },
    };

    this.notificationsService.notifyUser(recipientId, {
      ...copy[action],
      data: {
        type: 'meeting_answer',
        meetingId: row.id,
        clientId: row.client_id,
      },
    });
  }

  private async notifyOfCancel(
    row: MeetingRow,
    cancellerId: string,
  ): Promise<void> {
    const recipientId =
      cancellerId === row.coach_id ? row.client_id : row.coach_id;

    let cancellerName = cancellerId === row.coach_id ? 'Trenér' : 'Klient';
    try {
      cancellerName =
        (await this.displayNames([cancellerId])).get(cancellerId) ??
        cancellerName;
    } catch {
      // Generic name still makes the message readable.
    }

    this.notificationsService.notifyUser(recipientId, {
      title: 'Schůzka zrušena',
      body: `${cancellerName} zrušil termín ${this.formatSlot(row.starts_at)}.`,
      data: {
        type: 'meeting_cancelled',
        meetingId: row.id,
        clientId: row.client_id,
      },
    });
  }
}
