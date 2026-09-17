import { ThrottlerModuleOptions } from '@nestjs/throttler';
import { throttlerTracker } from './throttler-tracker';

/**
 * How much one caller may ask of the backend.
 *
 * The guard using this is registered globally (see `AppModule`), so it runs
 * before the controllers' `SupabaseAuthGuard` and turns a flood away without
 * spending a Supabase token validation on it.
 *
 * Storage is the package default, in memory. That is correct *because the
 * backend runs as a single supervisord process* on Roští — one process, one set
 * of counters. If it is ever run as more than one instance, this has to move to
 * Redis, or each instance will allow the full limit on its own.
 */
export const throttlerOptions = {
  getTracker: throttlerTracker,
  throttlers: [
    {
      // The whole-API budget for one session. Named `default` so that the
      // limit a client meets in normal use answers with a plain `Retry-After`;
      // the package suffixes that header with the throttler's name for every
      // other name.
      //
      // The default key generator buckets per route handler, which would let a
      // client spend the limit again on every endpoint it knows about. This one
      // ignores the handler, so the number below is what it sounds like.
      //
      // 120/minute is several times what the app needs when it is working
      // normally — a cold start is a couple of dozen requests and live data
      // arrives over Supabase subscriptions rather than polling — so it catches
      // a client stuck in a loop without ever being reachable by hand.
      name: 'default',
      ttl: 60_000,
      limit: 120,
      generateKey: (_context, tracker, name) => `${name}-${tracker}`,
    },
    {
      // Per-endpoint budget, for the routes that cost more than a database
      // read. Left at the API-wide ceiling so it never rejects anything on its
      // own — a route opts in with `@Throttle({ heavy: … })`.
      //
      // It is a second throttler rather than a tighter `default` because the
      // budget above is deliberately keyed without the handler: overriding it
      // on one route would change the threshold on the shared bucket, so a
      // caller who had done ordinary work that minute would be refused a photo
      // scan they had not made yet.
      name: 'heavy',
      ttl: 60_000,
      limit: 120,
    },
  ],
} satisfies ThrottlerModuleOptions;
