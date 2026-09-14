# Chat photos

Coach and client can send each other photos in their chat. A photo lives for
7 days. After that the file is deleted from storage and the message row from
`chat_messages`.

## Shape

- A photo is an ordinary `chat_messages` row: `kind = 'photo'`, `body = '📷'`,
  and `metadata.photo_path` naming the object in the `chat-photos` bucket
  (`{coachId}/{userId}/{uuid}.webp`). No extra column — age is `created_at`.
- The body is not empty because `chat_messages_body_check` (live in Supabase,
  not in this repo) rejects `''` — the first version sent that and every
  upload failed with a 500. An app build without photo support renders the
  emoji as a plain message.
- `POST /chat/with/:peerId/photo`, multipart field `file`, images only, capped
  at `MAX_IMAGE_BYTES`. Re-encoded to WebP, 1440px on the long edge.
- The bucket is private and has no storage policies. `getMessages` and
  `sendPhoto` attach `photo_url`, a signed URL valid for an hour. A public URL
  could be passed on, and the CDN keeps serving a public object for a while
  after deletion.
- Realtime rows carry the path but no URL, and the path alone opens nothing.
  The app refetches the first page to get the signed URL.

## Deletion

- `ChatService.purgeExpiredPhotosJob`, cron `15 * * * *`, runs
  `purgeExpiredPhotos` from `src/chat/chat-photo.ts`.
- Files first, rows second, 100 per pass. If storage fails the rows stay and
  the next hour retries; the other order would orphan files nothing points at.
  Removing a path that is already gone succeeds, so a retry is harmless.
- Worst case a photo lives 7 days plus an hour. Reads do not filter expired
  photos in between.
- Account deletion: `UserService.deleteUser` calls `removeChatPhotosOf` before
  `delete_user_account`, because the RPC deletes the rows that name the files.
- The app renders with expo-image `cachePolicy="memory"`, so no copy lands on
  the device's disk. Nothing stops a screenshot.

Covered by `src/chat/chat-photo.spec.ts` against a fake client: age boundary,
text messages untouched, retry on storage failure, paging past one batch.

## Side effects

- Retention scoring reads `chat_messages` in its window. Photo messages older
  than 7 days no longer count as coach–client contact; text messages do.
- An unread photo that expires drops out of the unread badge.

## Schema

`sql/2026-09-13_chat_photos.sql` creates the bucket and allows `'photo'` as a
kind. The original `chat_messages` definition is not in this repo, so the file
handles `kind` as either an enum or text with a check constraint. On the check
path it prints each replaced constraint as a NOTICE.
