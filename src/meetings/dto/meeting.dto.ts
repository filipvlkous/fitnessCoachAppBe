import {
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

/** Every status a meeting row can hold. */
export const MEETING_STATUSES = [
  'pending',
  'proposed',
  'approved',
  'declined',
  'cancelled',
] as const;

export type MeetingStatus = (typeof MEETING_STATUSES)[number];

/** What the responder can do with a meeting waiting on them. */
export const MEETING_ACTIONS = ['approve', 'decline', 'propose'] as const;

export type MeetingAction = (typeof MEETING_ACTIONS)[number];

export class CreateMeetingDto {
  /**
   * Optional: a client normally has one coach and the server resolves it. Sent
   * anyway when the app already knows, so a client with two relations does not
   * silently book the wrong one.
   */
  @IsOptional()
  @IsUUID()
  coachId?: string;

  @IsISO8601()
  startsAt: string;

  /**
   * Mirrors the check constraint on the table. A 400 here is a better answer
   * than a 500 from Postgres.
   */
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(240)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  location?: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}

export class RespondMeetingDto {
  @IsIn(MEETING_ACTIONS as readonly string[])
  action: MeetingAction;

  /** Required for `propose`, ignored otherwise. */
  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  /** Optional on `decline`. Nobody owes a reason for saying no. */
  @IsOptional()
  @IsString()
  @Length(1, 300)
  reason?: string;
}

/**
 * One meeting as both apps render it.
 *
 * `startsAt` is always the time currently on the table: the agreed slot once
 * approved, the client's ask while pending. A coach counter-offer rides along
 * in `proposedStartsAt` so the client's screen can show "you asked for X, they
 * suggest Y" without a second request.
 */
export interface MeetingView {
  id: string;
  coachId: string;
  clientId: string;
  /** The other party, from the requester's point of view. */
  peerId: string;
  peerName: string;
  startsAt: string;
  proposedStartsAt: string | null;
  durationMinutes: number;
  location: string | null;
  note: string | null;
  status: MeetingStatus;
  declineReason: string | null;
  cancelledBy: string | null;
  createdAt: string;
  /** True when this meeting is waiting on the requester's answer. */
  awaitingMe: boolean;
}
