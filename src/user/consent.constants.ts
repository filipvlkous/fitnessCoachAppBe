/**
 * Consent vocabulary and the age gate.
 *
 * The app has its own copy of these (constants/legal, utils/age) for the UI.
 * This copy is the one that decides: the app can be bypassed by anyone talking
 * to the API directly, so the check has to exist on both sides and the server's
 * answer is the one that counts.
 */

/**
 * Minimum age to consent to an information-society service on one's own in the
 * Czech Republic: § 7 z. č. 110/2019 Sb. sets it at 15 (the GDPR Art. 8 default
 * is 16; member states may lower it to 13, CZ chose 15).
 *
 * Below this we would need verified parental consent, which the app does not
 * offer — so consent is refused rather than recorded.
 */
export const MIN_AGE_YEARS = 15;

/** Sanity ceiling. Anything past this is a typo or a probe, not a birth date. */
const MAX_AGE_YEARS = 120;

export const CONSENT_KEYS = [
  'healthData',
  'coachSharing',
  'analytics',
  'marketing',
] as const;

export type ConsentKey = (typeof CONSENT_KEYS)[number];

/**
 * Slices of data a connected coach may read, within the `coachSharing` consent.
 *
 * These sit *under* coachSharing, not beside it: a granted scope means nothing
 * while coachSharing is off, so anything deriving actual access must AND the
 * two. The ledger stores what was decided; the ANDing happens on read.
 */
export const COACH_DATA_SCOPES = [
  'workouts',
  'nutrition',
  'bodyMetrics',
] as const;

export type CoachDataScope = (typeof COACH_DATA_SCOPES)[number];

/** Discriminates the two vocabularies sharing the ledger table. */
export const CONSENT_KIND = 'consent';
export const COACH_SCOPE_KIND = 'coachScope';

/**
 * Parses a strict `YYYY-MM-DD` date in UTC, or returns null.
 *
 * Deliberately not `new Date(value)`: that happily accepts `2001-02-30` and
 * rolls it into March, which would let an impossible date through the gate.
 */
export function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  // A rolled-over date no longer matches what was asked for.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

/** Completed years, counting the birthday itself as the day the age increases. */
export function ageInYears(dob: Date, on: Date): number {
  let age = on.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = on.getUTCMonth() - dob.getUTCMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && on.getUTCDate() < dob.getUTCDate())
  ) {
    age -= 1;
  }
  return age;
}

/**
 * True when `dob` clears the age gate.
 *
 * Evaluated a day ahead of UTC on purpose. The app computes the age in the
 * user's local time, so someone in UTC+13 whose birthday has already arrived
 * would otherwise be waved through by the app and rejected here. A day of slack
 * makes the server never stricter than the client, at the cost of admitting
 * someone at most a day early.
 */
export function meetsMinimumAge(dob: Date, on: Date): boolean {
  const tolerant = new Date(on.getTime() + 24 * 60 * 60 * 1000);
  return ageInYears(dob, tolerant) >= MIN_AGE_YEARS;
}

/** True for dates that cannot be anyone's birth date. */
export function isImplausibleBirthDate(dob: Date, on: Date): boolean {
  return dob.getTime() > on.getTime() || ageInYears(dob, on) > MAX_AGE_YEARS;
}
