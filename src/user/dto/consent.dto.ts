import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { CoachDataScope, ConsentKey } from '../consent.constants';

export class ConsentRecordDto {
  @IsBoolean()
  granted: boolean;

  /**
   * When the user made this decision. Null means "never answered" — those are
   * dropped rather than written, so the ledger only ever holds real decisions.
   */
  @IsOptional()
  @IsISO8601()
  decidedAt?: string | null;

  /** Policy version this decision was made against, not the current one. */
  @IsString()
  @Length(1, 32)
  policyVersion: string;
}

/**
 * A fixed set of properties rather than a `Record<string, …>`, so the global
 * `whitelist: true` pipe drops any key the app invents. The ledger can then only
 * hold consents we have actually described to the user in the privacy notice.
 */
export class ConsentsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ConsentRecordDto)
  healthData?: ConsentRecordDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConsentRecordDto)
  coachSharing?: ConsentRecordDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConsentRecordDto)
  analytics?: ConsentRecordDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConsentRecordDto)
  marketing?: ConsentRecordDto;
}

/** Scope of the `coachSharing` consent. Same shape, separate vocabulary. */
export class CoachPermissionsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ConsentRecordDto)
  workouts?: ConsentRecordDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConsentRecordDto)
  nutrition?: ConsentRecordDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConsentRecordDto)
  bodyMetrics?: ConsentRecordDto;
}

export class SaveConsentsDto {
  /**
   * `YYYY-MM-DD`. Optional only so a client that already synced a birth date
   * can omit it on later toggles; the age gate then runs against the stored
   * one. Consent is never recorded without an age check passing.
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dateOfBirth must be a YYYY-MM-DD date',
  })
  dateOfBirth?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  termsVersion?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  policyVersion?: string | null;

  @IsObject()
  @ValidateNested()
  @Type(() => ConsentsDto)
  consents: ConsentsDto;

  /** Optional so an app build predating coach scopes still syncs its consents. */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CoachPermissionsDto)
  coachPermissions?: CoachPermissionsDto;
}

interface RecordedDecision {
  granted: boolean;
  decidedAt: string | null;
  policyVersion: string;
}

/** Shape returned by both consent endpoints; mirrors `ConsentPayload` in the app. */
export interface ConsentPayload {
  dateOfBirth: string | null;
  termsVersion: string | null;
  policyVersion: string | null;
  /**
   * Only keys with a recorded decision appear. A missing key means "never
   * answered", which the app fills in from its own blank snapshot — better than
   * the server inventing a policy version for a decision nobody made.
   */
  consents: Partial<Record<ConsentKey, RecordedDecision>>;
  coachPermissions: Partial<Record<CoachDataScope, RecordedDecision>>;
}
