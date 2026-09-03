import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsISO8601,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * The timezone every stored minute-of-day is expressed in.
 *
 * A window is "Monday 09:00", which is not an instant — it needs a zone to
 * become one, and the app has no per-coach zone to offer. Hardcoded rather
 * than guessed from the device: the coach's own phone is the only correct
 * source, and a client abroad reading the coach's hours in their own zone
 * would see the wrong ones.
 *
 * The way out, when it is needed, is a `user.timezone` column backfilled with
 * this value; nothing about the stored shape changes. Which is why this must
 * stay one named constant rather than a string repeated at each use.
 */
export const COACH_TZ = 'Europe/Prague';

/** How far ahead a single availability lookup may reach. */
export const MAX_AVAILABILITY_SPAN_DAYS = 31;

/**
 * One recurring window. `weekday` is 0 = Sunday, matching JS `getDay()`, and
 * both minute fields count from midnight in {@link COACH_TZ}.
 */
export class AvailabilityWindowDto {
  @IsInt()
  @Min(0)
  @Max(6)
  weekday: number;

  @IsInt()
  @Min(0)
  @Max(1439)
  startsMinute: number;

  /** 1440 is midnight at the end of the day, so a window may close on it. */
  @IsInt()
  @Min(1)
  @Max(1440)
  endsMinute: number;
}

export class SetAvailabilityDto {
  /**
   * The complete week — this replaces what is stored rather than adding to it,
   * so an empty array is how a coach clears their availability.
   *
   * The cap is generous next to any real week (seven days of morning and
   * evening is fourteen) and only exists so one request cannot write
   * unbounded rows.
   */
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AvailabilityWindowDto)
  windows: AvailabilityWindowDto[];
}

export class AvailabilityRangeDto {
  /** Defaults to now. */
  @IsOptional()
  @IsISO8601()
  from?: string;

  /** Defaults to `from` + a day. */
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export interface AvailabilityWindowView {
  weekday: number;
  startsMinute: number;
  endsMinute: number;
}

/** A stretch of time the coach is already committed to. */
export interface BusyRange {
  startsAt: string;
  endsAt: string;
}

/**
 * What a client needs to draw a slot grid, and nothing more.
 *
 * Busy ranges carry no names, no notes and no ids: a client asking when their
 * coach is free must not learn who else is training with them.
 */
export interface BookableAvailability {
  timezone: string;
  windows: AvailabilityWindowView[];
  busy: BusyRange[];
}
