-- exercises.youtube_url — let a coach attach a YouTube demo to an exercise
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Every statement is idempotent, so re-running is safe.
--
--
-- ── RUN THIS BEFORE DEPLOYING THE MATCHING API BUILD ─────────────────────────
--
-- The API build that ships with this file reads and writes this column in
-- `ExercisesService.getMedia` / `create` / `update`. Without it, opening any
-- exercise fails with
--
--   42703  column exercises.youtube_url does not exist
--
-- and both the coach's exercise detail screen and the user's workout logger
-- lose their media sections entirely. Nothing existing is touched — the column
-- is added nullable with no default — so the file is safe to run well ahead of
-- the deploy: older API builds simply never select it.
--
--
-- ── Why a separate column and not `video_url` ────────────────────────────────
--
-- `video_url` is a Supabase Storage object the coach uploaded, and every code
-- path around it assumes that: `uploadMedia` writes it, `deleteMedia` and
-- `remove` parse it back into a bucket + path and delete the underlying file,
-- and the app hands it to expo-video and to the on-device video cache. A
-- youtube.com link stored there would be parsed as a storage location (it is
-- not one), handed to a player that cannot decode it, and downloaded by a
-- cache that would get an HTML page instead of an mp4.
--
-- The two are also complementary rather than alternatives: a coach can upload a
-- 20-second clip of their own cueing *and* link the full technique breakdown.
--
--
-- ── What is stored ───────────────────────────────────────────────────────────
--
-- The coach's link as they pasted it, trimmed — not a bare video id. The API
-- validates that a video id can be extracted before saving (so a non-YouTube
-- URL is rejected at write time rather than rendering as a blank player), but
-- keeps the original text so a `?t=90` start offset survives; the app re-parses
-- both the id and the offset when it builds the embed.

alter table public.exercises
  add column if not exists youtube_url text;

comment on column public.exercises.youtube_url is
  'Coach-supplied YouTube link for this exercise, stored as pasted (trimmed). '
  'The API rejects anything it cannot extract an 11-character video id from. '
  'Distinct from video_url, which is an uploaded Supabase Storage object.';


-- ── Verify ───────────────────────────────────────────────────────────────────
--
-- Expect every row to be null immediately after running, then only youtube.com
-- / youtu.be links as coaches fill them in.

select count(*) filter (where youtube_url is not null) as with_youtube,
       count(*)                                        as total
from public.exercises;
