import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { SupabaseService } from 'src/supabase/supabase.service';
import { FeedService } from 'src/feed/feed.service';

const CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class SupplementsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly feedService: FeedService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  private cacheKey(userId: string): string {
    return `supplements:${userId}`;
  }

  private async invalidateCache(userId: string): Promise<void> {
    await this.cacheManager.del(this.cacheKey(userId));
  }

  getFeedCache() {
    return this.feedService.getLocalCache();
  }

  async getUserSupplements(userId: string) {
    const cached = await this.cacheManager.get<object[]>(this.cacheKey(userId));
    if (cached) return cached;

    const { data, error } = await this.supabaseService.supabase
      .from('user_supplements')
      .select('code, id')
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Error fetching supplements: ${error.message}`);
    }

    const feedCache = this.feedService.getLocalCache();
    if (!feedCache || !data) return data;

    const userCodes = new Map(data.map((s) => [s.code, s.id]));

    const seen = new Set<string>();
    const matched: object[] = [];

    for (const items of Object.values(feedCache.byCategory)) {
      for (const item of items as { id: string; code: string }[]) {
        const supabaseId = userCodes.get(item.code) ?? userCodes.get(item.id);
        if (supabaseId && !seen.has(item.id)) {
          seen.add(item.id);
          matched.push({ ...item, supabaseId });
        }
      }
    }

    await this.cacheManager.set(this.cacheKey(userId), matched, CACHE_TTL_MS);
    return matched;
  }

  async addSupplementToUser(userId: string, id: string) {
    const rows = [{ user_id: userId, code: id }];
    const { data, error } = await this.supabaseService.supabase
      .from('user_supplements')
      .insert(rows)
      .select();

    if (error) {
      throw new Error(`Error adding supplements: ${error.message}`);
    }

    await this.invalidateCache(userId);
    return data;
  }

  async removeSupplementFromUser(userId: string, supplementId: string) {
    const { error } = await this.supabaseService.supabase
      .from('user_supplements')
      .delete()
      .eq('id', supplementId)
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Error removing supplement: ${error.message}`);
    }

    await this.invalidateCache(userId);
    return { message: 'Supplement removed successfully' };
  }
}
