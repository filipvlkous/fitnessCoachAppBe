/**
 * A Postgres `timestamp` (no zone) read as UTC. Such columns hold UTC but come
 * back without an offset, which a client would otherwise read as local time.
 * Values that already carry a zone pass through.
 */
export function asUtc(timestamp: string): string {
  return /(Z|[+-]\d{2}:?\d{2})$/.test(timestamp) ? timestamp : `${timestamp}Z`;
}
