import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';
import {
  SavePushTokenDto,
  SendNotificationDto,
  SendBulkNotificationDto,
} from './dto/notification.dto';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
// Expo rejects requests with more than 100 messages.
const EXPO_BATCH_SIZE = 100;

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  sound: string;
  data?: Record<string, unknown>;
}

export interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async savePushToken(userId: string, dto: SavePushTokenDto) {
    const { data, error } = await this.supabaseService.supabase
      .from('user_push_tokens')
      .upsert(
        {
          user_id: userId,
          token: dto.token,
          platform: dto.platform,
        },
        { onConflict: 'user_id' },
      )
      .select();

    if (error) {
      throw new InternalServerErrorException(
        `Error saving push token: ${error.message}`,
      );
    }

    return data;
  }

  async deletePushToken(userId: string, token: string) {
    const { error } = await this.supabaseService.supabase
      .from('user_push_tokens')
      .delete()
      .eq('user_id', userId)
      .eq('token', token);

    if (error) {
      throw new InternalServerErrorException(
        `Error deleting push token: ${error.message}`,
      );
    }

    return { message: 'Push token deleted' };
  }

  async sendToUser(userId: string, dto: SendNotificationDto) {
    const tokens = await this.getUserTokens(userId);
    if (tokens.length === 0) {
      return { message: 'No push token registered for this user' };
    }

    const messages: ExpoMessage[] = tokens.map((token) => ({
      to: token,
      title: dto.title,
      body: dto.body,
      sound: dto.sound ?? 'default',
      data: dto.data,
    }));

    return this.dispatchToExpo(messages);
  }

  /**
   * Fire-and-forget variant for use inside other services/controllers.
   * Never throws, so a push failure can't fail (or crash) the request
   * that triggered it.
   */
  notifyUser(userId: string, dto: SendNotificationDto): void {
    if (!userId) return;
    this.sendToUser(userId, dto).catch((err) =>
      this.logger.warn(
        `Push notification to user ${userId} failed: ${err.message}`,
      ),
    );
  }

  async sendToMultipleUsers(dto: SendBulkNotificationDto) {
    const { data, error } = await this.supabaseService.supabase
      .from('user_push_tokens')
      .select('token')
      .in('user_id', dto.userIds);

    if (error) {
      throw new InternalServerErrorException(
        `Error fetching push tokens: ${error.message}`,
      );
    }

    if (!data || data.length === 0) {
      return { message: 'No push tokens found for the given users' };
    }

    const messages: ExpoMessage[] = data.map((row) => ({
      to: row.token as string,
      title: dto.title,
      body: dto.body,
      sound: dto.sound ?? 'default',
      data: dto.data,
    }));

    return this.dispatchToExpo(messages);
  }

  private async getUserTokens(userId: string): Promise<string[]> {
    const { data, error } = await this.supabaseService.supabase
      .from('user_push_tokens')
      .select('token')
      .eq('user_id', userId);

    if (error || !data) return [];
    return data.map((row) => row.token as string);
  }

  private async dispatchToExpo(messages: ExpoMessage[]) {
    const tickets: ExpoTicket[] = [];

    for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
      const batch = messages.slice(i, i + EXPO_BATCH_SIZE);

      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(batch),
      });

      if (!response.ok) {
        throw new InternalServerErrorException(
          `Expo push API error: ${response.status} ${response.statusText}`,
        );
      }

      const json: any = await response.json();
      const batchTickets: ExpoTicket[] = json?.data ?? [];
      tickets.push(...batchTickets);

      await this.cleanupInvalidTokens(batch, batchTickets);
    }

    return { data: tickets };
  }

  /** Remove tokens Expo reports as no longer registered so we stop pushing to them. */
  private async cleanupInvalidTokens(
    batch: ExpoMessage[],
    tickets: ExpoTicket[],
  ) {
    const invalidTokens = batch
      .filter((_, i) => tickets[i]?.details?.error === 'DeviceNotRegistered')
      .map((message) => message.to);

    if (invalidTokens.length === 0) return;

    const { error } = await this.supabaseService.supabase
      .from('user_push_tokens')
      .delete()
      .in('token', invalidTokens);

    if (error) {
      this.logger.warn(
        `Failed to clean up stale push tokens: ${error.message}`,
      );
    }
  }
}
