import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private readonly cache = new Map<string, { user: any; expiresAt: number }>();
  private readonly TTL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_ENTRIES = 5000;

  constructor(private readonly supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
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

    try {
      const user = await this.supabaseService.validateUserToken(token);
      this.pruneCache();
      this.cache.set(token, { user, expiresAt: Date.now() + this.TTL_MS });
      request.user = user;
      return true;
    } catch {
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
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
