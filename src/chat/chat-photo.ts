import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Photos sent in the coach–client chat live for 7 days, message row included.
 *
 * Kept free of Nest and of the repo's absolute imports so the deletion rule can
 * be tested against a fake client.
 */

/** Private bucket. Objects are only ever served through signed URLs. */
export const CHAT_PHOTO_BUCKET = 'chat-photos';

export const CHAT_PHOTO_TTL_DAYS = 7;

/** Rows per pass; storage `remove` takes the paths as one request. */
const PURGE_BATCH = 100;

/** Photo messages created before this instant are expired. */
export function photoCutoff(now: Date): string {
  const ttlMs = CHAT_PHOTO_TTL_DAYS * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() - ttlMs).toISOString();
}

type PhotoRow = { id: string; metadata: { photo_path?: unknown } | null };

const pathsOf = (rows: PhotoRow[]): string[] =>
  rows
    .map((row) => row.metadata?.photo_path)
    .filter((path): path is string => typeof path === 'string');

/**
 * Deletes every expired photo message: the stored file first, then the row.
 *
 * In that order so a failed storage call leaves the rows — and with them the
 * paths — for the next run. The other way round, a failure would orphan files
 * nothing points at any more. Removing a path that is already gone succeeds, so
 * a retry after a half-finished pass is harmless.
 *
 * Returns how many messages were deleted.
 */
export async function purgeExpiredPhotos(
  supabase: SupabaseClient,
  now: Date,
): Promise<number> {
  const cutoff = photoCutoff(now);
  let deleted = 0;

  for (;;) {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, metadata')
      .eq('kind', 'photo')
      .lt('created_at', cutoff)
      .limit(PURGE_BATCH);

    if (error) {
      throw new Error(`Error reading expired chat photos: ${error.message}`);
    }

    const rows = (data ?? []) as PhotoRow[];
    if (rows.length === 0) return deleted;

    const paths = pathsOf(rows);
    if (paths.length > 0) {
      const { error: storageError } = await supabase.storage
        .from(CHAT_PHOTO_BUCKET)
        .remove(paths);

      if (storageError) {
        throw new Error(
          `Error deleting expired chat photos: ${storageError.message}`,
        );
      }
    }

    const { data: gone, error: deleteError } = await supabase
      .from('chat_messages')
      .delete()
      .in(
        'id',
        rows.map((row) => row.id),
      )
      .select('id');

    if (deleteError) {
      throw new Error(
        `Error deleting expired chat photo messages: ${deleteError.message}`,
      );
    }
    // Nothing deleted would mean the same page comes back forever.
    if (!gone || gone.length === 0) {
      throw new Error('Expired chat photo messages were not deleted');
    }

    deleted += gone.length;
    if (rows.length < PURGE_BATCH) return deleted;
  }
}

/**
 * Deletes the stored file of every photo in a user's chats, in either role.
 * For account deletion, which removes the rows — call it before that happens,
 * while the paths can still be read.
 */
export async function removeChatPhotosOf(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, metadata')
    .eq('kind', 'photo')
    .or(`coach_id.eq.${userId},user_id.eq.${userId}`);

  if (error) {
    throw new Error(`Error reading chat photos: ${error.message}`);
  }

  const paths = pathsOf((data ?? []) as PhotoRow[]);
  if (paths.length === 0) return;

  const { error: storageError } = await supabase.storage
    .from(CHAT_PHOTO_BUCKET)
    .remove(paths);

  if (storageError) {
    throw new Error(`Error deleting chat photos: ${storageError.message}`);
  }
}
