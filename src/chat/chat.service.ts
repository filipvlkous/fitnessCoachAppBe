import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { SupabaseService } from 'src/supabase/supabase.service';
import { AccessService } from 'src/auth/access.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { compressImage } from 'utils/compress-image';
import { CHAT_PHOTO_BUCKET, purgeExpiredPhotos } from './chat-photo';

export interface ChatMessage {
  id: string;
  coach_id: string;
  user_id: string;
  sender_id: string;
  kind: 'text' | 'workout_note' | 'photo';
  body: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
  /** Signed URL of a photo message, added on the way out. Not a column. */
  photo_url?: string | null;
}

/** The two participants of a chat, resolved and authorized. */
export interface ChatPair {
  coachId: string;
  userId: string;
}

/** Context the app sends when a user saves a set note to share with the coach. */
export interface WorkoutNoteInput {
  note: string;
  exerciseName: string;
  dayName?: string | null;
  setNumber?: number | null;
  weight?: number | null;
  reps?: number | null;
}

const DEFAULT_PAGE = 30;
const MAX_PAGE = 100;

/**
 * Lifetime of a signed photo URL. Long enough to read a chat, short enough that
 * a copied link is dead long before the photo's 7 days are up.
 */
const PHOTO_URL_TTL_SECONDS = 60 * 60;

/**
 * Body stored on a photo message. `chat_messages_body_check` rejects an empty
 * one, and an app build without photo support shows it as a plain message.
 */
const PHOTO_MESSAGE_BODY = '📷';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly accessService: AccessService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private get supabase() {
    return this.supabaseService.supabase;
  }

  /**
   * Figures out who is the coach and who is the client in a requester/peer
   * pair, rejecting when no approved relation exists in either direction.
   */
  async resolvePair(requesterId: string, peerId: string): Promise<ChatPair> {
    if (await this.accessService.isCoachOf(requesterId, peerId)) {
      return { coachId: requesterId, userId: peerId };
    }
    if (await this.accessService.isCoachOf(peerId, requesterId)) {
      return { coachId: peerId, userId: requesterId };
    }
    throw new ForbiddenException('No coach relation with this user.');
  }

  /** Newest-first page of messages; `before` is an exclusive cursor. */
  async getMessages(
    pair: ChatPair,
    before?: string,
    limit?: number,
  ): Promise<ChatMessage[]> {
    const pageSize = Math.min(Math.max(limit ?? DEFAULT_PAGE, 1), MAX_PAGE);

    let query = this.supabase
      .from('chat_messages')
      .select('*')
      .eq('coach_id', pair.coachId)
      .eq('user_id', pair.userId)
      .order('created_at', { ascending: false })
      .limit(pageSize);

    if (before) query = query.lt('created_at', before);

    const { data, error } = await query;
    if (error) throw new InternalServerErrorException(error.message);
    return this.withPhotoUrls((data ?? []) as ChatMessage[]);
  }

  async sendMessage(
    pair: ChatPair,
    senderId: string,
    body: string,
    kind: ChatMessage['kind'] = 'text',
    metadata?: Record<string, unknown>,
  ): Promise<ChatMessage> {
    const { data, error } = await this.supabase
      .from('chat_messages')
      .insert({
        coach_id: pair.coachId,
        user_id: pair.userId,
        sender_id: senderId,
        kind,
        body,
        metadata: metadata ?? null,
      })
      .select('*')
      .single();

    if (error) throw new InternalServerErrorException(error.message);

    const recipientId =
      senderId === pair.coachId ? pair.userId : pair.coachId;
    this.notificationsService.notifyUser(recipientId, {
      title:
        senderId === pair.coachId
          ? 'New message from your coach'
          : 'New message from your client',
      body:
        kind === 'photo'
          ? 'Sent a photo'
          : body.length > 120
            ? `${body.slice(0, 117)}…`
            : body,
      data: { type: 'chat_message', peerId: senderId },
    });

    return data as ChatMessage;
  }

  /**
   * Stores a photo in the private bucket and posts it as a `photo` message.
   * `purgeExpiredPhotosJob` deletes both the file and the row after 7 days.
   */
  async sendPhoto(
    pair: ChatPair,
    senderId: string,
    file: Express.Multer.File,
  ): Promise<ChatMessage> {
    // 1440px on the long edge, the most any upload in this app keeps.
    const compressed = await compressImage(file.buffer, {
      maxWidth: 1440,
      maxHeight: 1440,
    });
    const path = `${pair.coachId}/${pair.userId}/${randomUUID()}.webp`;
    const storage = this.supabase.storage.from(CHAT_PHOTO_BUCKET);

    const { error: uploadError } = await storage.upload(path, compressed, {
      contentType: 'image/webp',
      upsert: false,
    });
    if (uploadError) {
      throw new InternalServerErrorException(
        `Error uploading chat photo: ${uploadError.message}`,
      );
    }

    let message: ChatMessage;
    try {
      message = await this.sendMessage(
        pair,
        senderId,
        PHOTO_MESSAGE_BODY,
        'photo',
        { photo_path: path },
      );
    } catch (error) {
      // Without a row nothing points at the file, so the purge would never
      // find it.
      await storage.remove([path]);
      throw error;
    }

    const [signed] = await this.withPhotoUrls([message]);
    return signed;
  }

  /** Adds a signed URL to every photo message; the bucket itself is private. */
  private async withPhotoUrls(messages: ChatMessage[]): Promise<ChatMessage[]> {
    const paths = messages
      .map((message) => message.metadata?.photo_path)
      .filter((path): path is string => typeof path === 'string');
    if (paths.length === 0) return messages;

    const { data, error } = await this.supabase.storage
      .from(CHAT_PHOTO_BUCKET)
      .createSignedUrls(paths, PHOTO_URL_TTL_SECONDS);
    if (error) throw new InternalServerErrorException(error.message);

    const urlByPath = new Map(
      (data ?? []).map((entry) => [
        entry.path,
        entry.error ? null : entry.signedUrl,
      ]),
    );
    return messages.map((message) =>
      message.kind === 'photo'
        ? {
            ...message,
            photo_url:
              urlByPath.get(message.metadata?.photo_path as string) ?? null,
          }
        : message,
    );
  }

  /**
   * Deletes photos — file and message — once they are 7 days old. Hourly, so
   * none outlives that by more than an hour.
   */
  @Cron('15 * * * *')
  async purgeExpiredPhotosJob(): Promise<void> {
    try {
      const deleted = await purgeExpiredPhotos(this.supabase, new Date());
      if (deleted > 0) {
        this.logger.log(`Deleted ${deleted} expired chat photos.`);
      }
    } catch (error) {
      this.logger.error(
        `Chat photo purge failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Marks everything the reader received in this chat as read. */
  async markRead(pair: ChatPair, readerId: string) {
    const { error } = await this.supabase
      .from('chat_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('coach_id', pair.coachId)
      .eq('user_id', pair.userId)
      .neq('sender_id', readerId)
      .is('read_at', null);

    if (error) throw new InternalServerErrorException(error.message);
    return { message: 'Chat marked as read' };
  }

  /** Unread message counts grouped by chat peer (for list badges). */
  async unreadCounts(meId: string): Promise<{ peer_id: string; count: number }[]> {
    const { data, error } = await this.supabase
      .from('chat_messages')
      .select('coach_id, user_id, sender_id')
      .or(`coach_id.eq.${meId},user_id.eq.${meId}`)
      .neq('sender_id', meId)
      .is('read_at', null);

    if (error) throw new InternalServerErrorException(error.message);

    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      const peer = row.coach_id === meId ? row.user_id : row.coach_id;
      counts.set(peer, (counts.get(peer) ?? 0) + 1);
    }
    return [...counts.entries()].map(([peer_id, count]) => ({
      peer_id,
      count,
    }));
  }

  /**
   * Sends a set note the user just saved to their coach chat as a
   * workout_note, carrying the workout context (day, exercise, set, weight x
   * reps) in metadata. No-ops for a user without an approved coach.
   */
  async sendWorkoutNoteToCoach(
    userId: string,
    input: WorkoutNoteInput,
  ): Promise<{ sent: boolean; message?: ChatMessage }> {
    const body = input.note.trim();
    if (!body) return { sent: false };

    const coachId = await this.coachOf(userId);
    if (!coachId) return { sent: false }; // no coach to notify

    const message = await this.sendMessage(
      { coachId, userId },
      userId,
      body,
      'workout_note',
      {
        workout_date: new Date().toISOString().slice(0, 10),
        day_name: input.dayName ?? null,
        exercise_name: input.exerciseName,
        set_number: input.setNumber ?? null,
        weight: input.weight ?? null,
        reps: input.reps ?? null,
      },
    );

    return { sent: true, message };
  }

  /** The user's approved coach, if any. */
  private async coachOf(userId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('coach_user_relations')
      .select('coach_id')
      .eq('user_id', userId)
      .eq('status', 'approved')
      .limit(1)
      .maybeSingle();
    return data?.coach_id ?? null;
  }
}
