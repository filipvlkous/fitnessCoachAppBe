import { Injectable } from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';
import {
  SavePushTokenDto,
  SendNotificationDto,
  SendBulkNotificationDto,
} from './dto/notification.dto';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  sound: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
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
        { onConflict: 'token' }, // if token exists, update its user_id
      )
      .select();

    if (error) {
      throw new Error(`Error saving push token: ${error.message}`);
    }

    return data;
  }

  async deletePushToken(userId: string, token?: string) {
    const { error } = await this.supabaseService.supabase
      .from('user_push_tokens')
      .delete()
      .eq('user_id', userId);
    // .eq('token', token); // only delete this device's token
  }

  async sendToUser(userId: string, dto: SendNotificationDto) {
    const token = await this.getUserToken(userId);
    if (!token) {
      return { message: 'No push token registered for this user' };
    }

    return this.dispatchToExpo([
      {
        to: token,
        title: dto.title,
        body: dto.body,
        sound: dto.sound ?? 'default',
        data: dto.data,
      },
    ]);
  }

  async sendToMultipleUsers(dto: SendBulkNotificationDto) {
    const { data, error } = await this.supabaseService.supabase
      .from('user_push_tokens')
      .select('token')
      .in('user_id', dto.userIds);

    if (error) {
      throw new Error(`Error fetching push tokens: ${error.message}`);
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

  private async getUserToken(userId: string): Promise<string | null> {
    const { data, error } = await this.supabaseService.supabase
      .from('user_push_tokens')
      .select('token')
      .eq('user_id', userId)
      .single();

    if (error || !data) return null;
    return data.token as string;
  }

  private async dispatchToExpo(message: ExpoMessage[]) {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      throw new Error(`Expo push API error: ${response.statusText}`);
    }

    return response.json();
  }
}
