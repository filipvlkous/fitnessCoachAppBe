import { CacheInterceptor } from '@nestjs/cache-manager';
import { ExecutionContext, Injectable } from '@nestjs/common';

/**
 * Extends the default CacheInterceptor to scope every cache key to the
 * authenticated user's ID (set on request.user by SupabaseAuthGuard).
 *
 * Key format:  user:<userId>:<originalUrl>
 *
 * This prevents two different users from ever reading each other's cached
 * responses, even when they hit the same URL (e.g. shared workout/program IDs).
 *
 * For genuinely public / shared resources (e.g. the exercises catalogue) you
 * can still use the plain CacheInterceptor from @nestjs/cache-manager.
 */
@Injectable()
export class UserScopedCacheInterceptor extends CacheInterceptor {
  trackBy(context: ExecutionContext): string {
    const req = context.switchToHttp().getRequest();
    const userId = req.user?.id ?? 'anon';
    const url: string = req.url; // e.g. /workoutHistory?date=2026-03&user_workout_program_id=abc
    return `user:${userId}:${url}`;
  }
}

/**
 * Helper to build a user-scoped cache key that matches what
 * UserScopedCacheInterceptor stores.  Use this in controllers when you need
 * to manually delete a cached entry.
 *
 * Example:
 *   await this.cacheManager.del(userCacheKey(userId, '/programs/users/' + userId + '/all'));
 */
export function userCacheKey(userId: string, urlPath: string): string {
  return `user:${userId}:${urlPath}`;
}
