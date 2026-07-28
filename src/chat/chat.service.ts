import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';
import { AccessService } from 'src/auth/access.service';
import { NotificationsService } from 'src/notifications/notifications.service';

export interface ChatMessage {
  id: string;
  coach_id: string;
  user_id: string;
  sender_id: string;
  kind: 'text' | 'workout_note';
  body: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
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

@Injectable()
export class ChatService {
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
    return (data ?? []) as ChatMessage[];
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
      body: body.length > 120 ? `${body.slice(0, 117)}…` : body,
      data: { type: 'chat_message', peerId: senderId },
    });

    return data as ChatMessage;
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
