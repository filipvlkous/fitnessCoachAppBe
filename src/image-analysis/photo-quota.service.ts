import {
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';
import { localDateStr } from 'utils/getLocalTime';

/** Used when the user row does not carry the settings yet. */
const DEFAULT_DAILY_LIMIT = 3;
const DEFAULT_COOLDOWN_MINUTES = 5;

export interface PhotoQuota {
  limit: number;
  used: number;
  remaining: number;
  /** The day the allowance belongs to, as "YYYY-MM-DD" in Europe/Prague. */
  day: string;
  /** How long a cancelled scan pauses scanning for. */
  cooldownMinutes: number;
  /** ISO time before which no scan is accepted; null when not paused. */
  cooldownUntil: string | null;
}

/**
 * The per-user photo allowance (`user.daily_photo_limit`) and the pause after a
 * cancelled scan (`user.photo_cooldown_minutes`).
 *
 * A scan is booked before Gemini is called and only handed back if the call
 * fails, so a scan the athlete cancels mid-way — which Gemini still bills —
 * counts toward the day. See sql/2026-10-08_photo_scan_quota.sql.
 */
@Injectable()
export class PhotoQuotaService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async getQuota(userId: string): Promise<PhotoQuota> {
    const day = localDateStr(new Date());
    const [settings, used] = await Promise.all([
      this.settings(userId),
      this.countScans(userId, day),
    ]);
    return this.toQuota(settings, used, day);
  }

  /**
   * Book one scan against today's allowance, returning the ledger row's id so
   * a failed scan can hand it back.
   *
   * Claim-then-check, as `MacrosService.claimMealChange`: two scans sent
   * together both insert, and only the ones whose row sits within the limit in
   * the day's (created_at, id) order go through.
   */
  async claimScan(userId: string): Promise<string> {
    const day = localDateStr(new Date());
    const settings = await this.settings(userId);

    if (this.isCoolingDown(settings.cooldownUntil)) {
      const used = await this.countScans(userId, day);
      throw this.rejection(
        'PHOTO_COOLDOWN',
        'Scanning is paused after a cancelled scan',
        this.toQuota(settings, used, day),
      );
    }

    const { data: claim, error } = await this.supabaseService.supabase
      .from('photo_scan_log')
      .insert({ user_id: userId, day })
      .select('id')
      .single();

    if (error || !claim) {
      throw new InternalServerErrorException(
        `Error claiming a photo scan: ${error?.message ?? 'no row returned'}`,
      );
    }

    const { data: rows, error: readError } = await this.supabaseService.supabase
      .from('photo_scan_log')
      .select('id')
      .eq('user_id', userId)
      .eq('day', day)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    if (readError) {
      await this.refundScan(String(claim.id));
      throw new InternalServerErrorException(
        `Error reading photo quota: ${readError.message}`,
      );
    }

    const position = (rows ?? []).findIndex(
      (row) => String(row.id) === String(claim.id),
    );

    if (position < 0 || position >= settings.limit) {
      await this.refundScan(String(claim.id));
      const used = await this.countScans(userId, day);
      throw this.rejection(
        'PHOTO_LIMIT_REACHED',
        `Only ${settings.limit} photo scans are allowed per day`,
        this.toQuota(settings, used, day),
      );
    }

    return String(claim.id);
  }

  /** Gives a booked scan back — for a scan the AI never answered. */
  async refundScan(claimId: string): Promise<void> {
    const { error } = await this.supabaseService.supabase
      .from('photo_scan_log')
      .delete()
      .eq('id', claimId);

    if (error) {
      console.error('[photo-quota] refund failed:', error.message);
    }
  }

  /**
   * The athlete abandoned a running scan. It stays counted; scanning pauses
   * for the user's cooldown, which also turns away the abandoned request if it
   * has not reached the server yet.
   */
  async cancelScan(userId: string): Promise<PhotoQuota> {
    const settings = await this.settings(userId);
    const cooldownUntil =
      settings.cooldownMinutes > 0
        ? new Date(Date.now() + settings.cooldownMinutes * 60_000).toISOString()
        : null;

    const { error } = await this.supabaseService.supabase
      .from('user')
      .update({ photo_cooldown_until: cooldownUntil })
      .eq('id', userId);

    if (error) {
      throw new InternalServerErrorException(
        `Error pausing photo scans: ${error.message}`,
      );
    }

    const day = localDateStr(new Date());
    const used = await this.countScans(userId, day);
    return this.toQuota({ ...settings, cooldownUntil }, used, day);
  }

  private async settings(userId: string) {
    const { data, error } = await this.supabaseService.supabase
      .from('user')
      .select('daily_photo_limit, photo_cooldown_minutes, photo_cooldown_until')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(
        `Error reading photo settings: ${error.message}`,
      );
    }

    const row = data as {
      daily_photo_limit: number | null;
      photo_cooldown_minutes: number | null;
      photo_cooldown_until: string | null;
    } | null;

    return {
      limit: row?.daily_photo_limit ?? DEFAULT_DAILY_LIMIT,
      cooldownMinutes: row?.photo_cooldown_minutes ?? DEFAULT_COOLDOWN_MINUTES,
      cooldownUntil: row?.photo_cooldown_until ?? null,
    };
  }

  private async countScans(userId: string, day: string): Promise<number> {
    const { count, error } = await this.supabaseService.supabase
      .from('photo_scan_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('day', day);

    if (error) {
      throw new InternalServerErrorException(
        `Error reading photo quota: ${error.message}`,
      );
    }

    return count ?? 0;
  }

  private isCoolingDown(cooldownUntil: string | null): boolean {
    return !!cooldownUntil && new Date(cooldownUntil).getTime() > Date.now();
  }

  private toQuota(
    settings: {
      limit: number;
      cooldownMinutes: number;
      cooldownUntil: string | null;
    },
    used: number,
    day: string,
  ): PhotoQuota {
    return {
      limit: settings.limit,
      used,
      remaining: Math.max(0, settings.limit - used),
      day,
      cooldownMinutes: settings.cooldownMinutes,
      cooldownUntil: this.isCoolingDown(settings.cooldownUntil)
        ? settings.cooldownUntil
        : null,
    };
  }

  // 429, as the meal-edit limit: nothing about the request is wrong, only its
  // timing. `quota` lets the app show the real numbers without asking again.
  private rejection(code: string, message: string, quota: PhotoQuota) {
    return new HttpException(
      { statusCode: HttpStatus.TOO_MANY_REQUESTS, code, message, quota },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
