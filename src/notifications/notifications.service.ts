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
    const { data: updated, error: updateError } = await this.supabaseService.supabase
      .from('user_push_tokens')
      .update({ token: dto.token, platform: dto.platform })
      .eq('user_id', userId)
      .select();

    if (updateError) {
      throw new Error(`Error saving push token: ${updateError.message}`);
    }

    if (updated && updated.length > 0) {
      return updated;
    }

    const { data: inserted, error: insertError } = await this.supabaseService.supabase
      .from('user_push_tokens')
      .insert({ user_id: userId, token: dto.token, platform: dto.platform })
      .select();

    if (insertError) {
      throw new Error(`Error saving push token: ${insertError.message}`);
    }

    return inserted;
  }

  async deletePushToken(userId: string) {
    const { error } = await this.supabaseService.supabase
      .from('user_push_tokens')
      .delete()
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Error deleting push token: ${error.message}`);
    }

    return { message: 'Push token removed' };
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
