import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';
import { AccessService } from 'src/auth/access.service';
import {
  AvailabilityRangeDto,
  AvailabilityWindowView,
  BookableAvailability,
  BusyRange,
  COACH_TZ,
  MAX_AVAILABILITY_SPAN_DAYS,
  SetAvailabilityDto,
} from './dto/availability.dto';

interface AvailabilityRow {
  weekday: number;
  starts_minute: number;
  ends_minute: number;
}

/**
 * The status that marks a `gym_meetings` row as a coach's window rather than a
 * session. Rows carrying it have no client and no `starts_at`, and are the
 * only rows allowed to fill the weekday/minute columns — see
 * `sql/2026-09-02_gym_meetings_availability.sql`.
 */
const AVAILABILITY_STATUS = 'availability';

/** The columns an availability row actually uses. */
const AVAILABILITY_COLUMNS = 'weekday, starts_minute, ends_minute';

/**
 * The longest a single meeting can run, mirroring the check constraint on
 * `gym_meetings`. Used to widen the busy lookup: a session that started before
 * the window still occupies part of it.
 */
const MAX_MEETING_MINUTES = 240;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When a coach accepts session requests.
 *
 * Stored as recurring weekly windows, so the answer to "when may I ask?" is
 * the same shape in six months. The windows do not *enforce* anything: a
 * request outside them still reaches the coach, who is free to say yes. They
 * exist so the client's picker can stop offering hours that were always going
 * to be declined.
 *
 * They share `gym_meetings` with the sessions themselves, under a status of
 * their own. Every query here therefore says which kind of row it wants, and
 * every query in `MeetingsService` filters these out — a window is not a
 * meeting and must never be counted as one.
 */
@Injectable()
export class CoachAvailabilityService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly accessService: AccessService,
  ) {}

  private get supabase() {
    return this.supabaseService.supabase;
  }

  /** The signed-in coach's own week. */
  async listOwn(coachId: string): Promise<AvailabilityWindowView[]> {
    return this.windowsFor(coachId);
  }

  /**
   * Replaces the coach's whole week.
   *
   * A whole-week write rather than per-row edits: the screen that calls this
   * is a week at a time, and diffing seven days of windows on the client to
   * send three requests instead of one would be more code on both sides for
   * the same result.
   */
  async replaceOwn(
    coachId: string,
    dto: SetAvailabilityDto,
  ): Promise<AvailabilityWindowView[]> {
    await this.accessService.assertCoachRole(coachId);
    assertNoOverlap(dto.windows);

    // Delete then insert, in that order deliberately. The reverse would leave
    // a doubled week behind if the delete failed — windows that look right and
    // silently offer every slot twice. This way a failure leaves the week
    // empty, which the coach can see and fix by saving again.
    const { error: clearError } = await this.supabase
      .from('gym_meetings')
      .delete()
      .eq('coach_id', coachId)
      // Never without the status: the same call without it would delete the
      // coach's entire meeting history.
      .eq('status', AVAILABILITY_STATUS);

    if (clearError) {
      throw new InternalServerErrorException(
        `Error clearing availability: ${clearError.message}`,
      );
    }

    if (dto.windows.length === 0) return [];

    // client_id and starts_at stay null, which is what the shape constraints
    // require of an availability row. duration_minutes takes the column
    // default and means nothing here — the window is the minute pair.
    const { error } = await this.supabase.from('gym_meetings').insert(
      dto.windows.map((window) => ({
        coach_id: coachId,
        status: AVAILABILITY_STATUS,
        weekday: window.weekday,
        starts_minute: window.startsMinute,
        ends_minute: window.endsMinute,
      })),
    );

    if (error) {
      throw new InternalServerErrorException(
        `Error saving availability: ${error.message}`,
      );
    }

    return this.listOwn(coachId);
  }

  /**
   * What a client needs to draw the slot grid for one coach: the recurring
   * windows, and the stretches inside the asked-for range that are already
   * taken.
   *
   * Only the coach's own clients may ask — otherwise anyone with an account
   * could map out a stranger's working week.
   */
  async forBooking(
    callerId: string,
    coachId: string,
    range: AvailabilityRangeDto,
  ): Promise<BookableAvailability> {
    if (
      callerId !== coachId &&
      !(await this.accessService.isCoachOf(coachId, callerId))
    ) {
      throw new ForbiddenException('This is not your coach.');
    }

    const from = range.from ? new Date(range.from) : new Date();
    const to = range.to
      ? new Date(range.to)
      : new Date(from.getTime() + DAY_MS);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Invalid range.');
    }
    if (to <= from) {
      throw new BadRequestException('The range ends before it starts.');
    }
    if (to.getTime() - from.getTime() > MAX_AVAILABILITY_SPAN_DAYS * DAY_MS) {
      throw new BadRequestException(
        `Ask for at most ${MAX_AVAILABILITY_SPAN_DAYS} days at a time.`,
      );
    }

    const [windows, busy] = await Promise.all([
      this.windowsFor(coachId),
      this.busyFor(coachId, from, to),
    ]);

    return { timezone: COACH_TZ, windows, busy };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async windowsFor(coachId: string): Promise<AvailabilityWindowView[]> {
    const { data, error } = await this.supabase
      .from('gym_meetings')
      .select(AVAILABILITY_COLUMNS)
      .eq('coach_id', coachId)
      .eq('status', AVAILABILITY_STATUS)
      .order('weekday', { ascending: true })
      .order('starts_minute', { ascending: true })
      .returns<AvailabilityRow[]>();

    if (error) {
      throw new InternalServerErrorException(
        `Error fetching availability: ${error.message}`,
      );
    }

    return (data ?? []).map(toView);
  }

  /**
   * Approved sessions overlapping the range — times only.
   *
   * Nothing identifying comes back: a client asking when their coach is free
   * has no business learning who the other slots belong to. Pending requests
   * are not busy either; nobody has agreed to those yet, and treating them as
   * taken would let one client hold a slot just by asking for it.
   */
  private async busyFor(
    coachId: string,
    from: Date,
    to: Date,
  ): Promise<BusyRange[]> {
    // A session starting before the range can still run into it, so the query
    // reaches back by the longest a meeting may last and the overlap is
    // settled below on the computed end.
    const lookBack = new Date(from.getTime() - MAX_MEETING_MINUTES * 60 * 1000);

    const { data, error } = await this.supabase
      .from('gym_meetings')
      .select('starts_at, duration_minutes')
      .eq('coach_id', coachId)
      .eq('status', 'approved')
      .gte('starts_at', lookBack.toISOString())
      .lt('starts_at', to.toISOString())
      .order('starts_at', { ascending: true })
      .returns<{ starts_at: string; duration_minutes: number }[]>();

    if (error) {
      throw new InternalServerErrorException(
        `Error fetching booked slots: ${error.message}`,
      );
    }

    return (data ?? [])
      .map((row) => {
        const startsAt = new Date(row.starts_at);
        return {
          startsAt: startsAt.toISOString(),
          endsAt: new Date(
            startsAt.getTime() + row.duration_minutes * 60 * 1000,
          ).toISOString(),
        };
      })
      .filter((busy) => new Date(busy.endsAt) > from);
  }
}

function toView(row: AvailabilityRow): AvailabilityWindowView {
  return {
    weekday: row.weekday,
    startsMinute: row.starts_minute,
    endsMinute: row.ends_minute,
  };
}

/**
 * Two windows on one day that overlap would put the same slot in the grid
 * twice. The schema cannot see across rows, so the check lives here.
 */
function assertNoOverlap(windows: SetAvailabilityDto['windows']): void {
  const byDay = new Map<
    number,
    { startsMinute: number; endsMinute: number }[]
  >();

  for (const window of windows) {
    if (window.endsMinute <= window.startsMinute) {
      throw new BadRequestException('A window must end after it starts.');
    }
    const day = byDay.get(window.weekday) ?? [];
    day.push(window);
    byDay.set(window.weekday, day);
  }

  for (const day of byDay.values()) {
    const sorted = [...day].sort((a, b) => a.startsMinute - b.startsMinute);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].startsMinute < sorted[i - 1].endsMinute) {
        throw new BadRequestException('Two windows on the same day overlap.');
      }
    }
  }
}
