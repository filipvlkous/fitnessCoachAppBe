import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';
import { requestIp } from 'src/throttler-tracker';

/**
 * Failed token checks per address, shared by every guard instance (Nest makes
 * one per module). The throttler counts a request against its bearer token, so
 * a fresh made-up token per request gets a fresh budget every time; this is
 * what stops those from each costing a Supabase round trip.
 */
const FAILURE_WINDOW_MS = 60 * 1000;
const MAX_FAILURES = 20;
const MAX_TRACKED_IPS = 10000;
const failures = new Map<string, { count: number; windowStart: number }>();

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private readonly cache = new Map<
    string,
    { user: unknown; expiresAt: number }
  >();
  // Short, because a hit skips Supabase: a signed-out session or a deleted
  // account keeps working from the cache until its entry runs out.
  private readonly TTL_MS = 30 * 1000;
  private readonly MAX_ENTRIES = 5000;

  constructor(private readonly supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: unknown;
    }>();
    const authHeader = request.headers['authorization'];
    if (!authHeader) throw new UnauthorizedException('No token provided');

    const [scheme, token] = authHeader.split(' ');
    if (!token || scheme.toLowerCase() !== 'bearer') {
      throw new UnauthorizedException('Expected "Bearer <token>" header');
    }

    const cached = this.cache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      request.user = cached.user;
      return true;
    }
    if (cached) this.cache.delete(token);

    const ip = requestIp(request);
    if (tooManyFailures(ip)) {
      throw new HttpException(
        'Too many invalid tokens',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      const user = await this.supabaseService.validateUserToken(token);
      this.pruneCache();
      this.cache.set(token, {
        user,
        expiresAt: Math.min(Date.now() + this.TTL_MS, tokenExpiresAt(token)),
      });
      request.user = user;
      return true;
    } catch {
      recordFailure(ip);
      throw new UnauthorizedException('Invalid token');
    }
  }

  // Keeps the token cache bounded: drop expired entries first, then oldest.
  private pruneCache() {
    if (this.cache.size < this.MAX_ENTRIES) return;

    const now = Date.now();
    for (const [key, value] of this.cache) {
      if (value.expiresAt <= now) this.cache.delete(key);
    }

    while (this.cache.size >= this.MAX_ENTRIES) {
      const oldest: string | undefined = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}

/**
 * The token's own `exp`, in ms. Read without verifying: Supabase has just
 * validated this token, and the value only shortens how long it is cached.
 * Anything unreadable counts as already expired, so it is not cached at all.
 */
function tokenExpiresAt(token: string): number {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
    ) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function tooManyFailures(ip: string): boolean {
  const entry = failures.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.windowStart >= FAILURE_WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const entry = failures.get(ip);
  if (entry && now - entry.windowStart < FAILURE_WINDOW_MS) {
    entry.count += 1;
    return;
  }

  if (failures.size >= MAX_TRACKED_IPS) {
    for (const [key, value] of failures) {
      if (now - value.windowStart >= FAILURE_WINDOW_MS) failures.delete(key);
    }
    // Still full of live entries: forget the oldest rather than grow.
    if (failures.size >= MAX_TRACKED_IPS) {
      const oldest: string | undefined = failures.keys().next().value;
      if (oldest !== undefined) failures.delete(oldest);
    }
  }
  failures.set(ip, { count: 1, windowStart: now });
}
