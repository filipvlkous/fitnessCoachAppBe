import { IsBoolean, IsIn } from 'class-validator';
import { COACH_DATA_SCOPES } from '../consent.constants';
// `import type` is required by emitDecoratorMetadata under isolatedModules:
// a type named in a decorated signature must not look like a value import.
import type { CoachDataScope } from '../consent.constants';

export class CreateAccessRequestDto {
  /**
   * Constrained to the known vocabulary rather than any string: this value
   * reaches a check constraint either way, but a 400 here is a better answer
   * than a 500 from Postgres.
   */
  @IsIn(COACH_DATA_SCOPES as readonly string[])
  scope: CoachDataScope;
}

export class ResolveAccessRequestDto {
  @IsBoolean()
  granted: boolean;
}

/** What the client's app renders. Carries no data from the scope itself. */
export interface AccessRequestView {
  id: string;
  coachId: string;
  coachName: string;
  scope: CoachDataScope;
  createdAt: string;
}
