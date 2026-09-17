import { createHash } from 'node:crypto';

/**
 * Who a request is counted against by the rate limiter.
 *
 * The throttler guard is registered globally, so it runs *before* the
 * controller's `SupabaseAuthGuard` and `request.user` does not exist yet. The
 * bearer token is the only per-caller identity available at that point, and it
 * is enough: it is issued per session, so a person's two devices get their own
 * budget and one looping client cannot spend someone else's.
 *
 * It is hashed rather than used raw — the tracker string ends up in a storage
 * key, and nothing that is merely a cache key should hold a usable access
 * token.
 *
 * Requests without a token (the public routes: `/`, `/join`, `/app-version`)
 * fall back to the caller's address. `req.ip` is useless here: nginx on Roští
 * proxies from 127.0.0.1 and sets `X-Real-IP` but not `X-Forwarded-For`, so
 * Express reports every request as local and the whole world would share one
 * bucket. `X-Real-IP` is safe to trust because nginx overwrites it with
 * `$remote_addr`, discarding whatever the client sent.
 */
export function throttlerTracker(req: Record<string, any>): string {
  const headers = (req?.headers ?? {}) as Record<
    string,
    string | string[] | undefined
  >;

  const authorization = headers['authorization'];
  if (typeof authorization === 'string') {
    const [scheme, token] = authorization.split(' ');
    if (token && scheme.toLowerCase() === 'bearer') {
      // 22 base64url characters is 132 bits — far past any chance of two
      // sessions colliding into a shared budget.
      const digest = createHash('sha256').update(token).digest('base64url');
      return `token:${digest.slice(0, 22)}`;
    }
  }

  const realIp = headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return `ip:${realIp.trim()}`;
  }

  const remote: unknown = req?.ip;
  return `ip:${typeof remote === 'string' && remote ? remote : 'unknown'}`;
}
