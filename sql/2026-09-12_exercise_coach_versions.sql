-- exercise_coach_versions — a coach's own take on a shared catalogue exercise
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Every statement is idempotent, so re-running is safe.
--
--
-- ── RUN THIS BEFORE DEPLOYING THE MATCHING API BUILD ─────────────────────────
--
-- The API build that ships with this file reads this table on every
-- `GET /exercises/:id/media`, which is what the workout logger calls for the
-- image, the clip and the YouTube link. Without the table that endpoint fails
-- with
--
--   42P01  relation "public.exercise_coach_versions" does not exist
--
-- and every athlete loses the media sections of the exercise they are logging.
-- Nothing existing is touched — this only adds a table — so it is safe to run
-- well ahead of the deploy: older API builds never select from it.
--
--
-- ── Why a separate table and not more columns on `exercises` ─────────────────
--
-- `exercises` is one shared catalogue row per movement, and any coach may edit
-- it, so a second coach's wording would overwrite the first's. The content here
-- is per (exercise, coach) by nature: two coaches cue the same squat
-- differently and each wants their own clients to read their own words.
--
-- The row is an override layer, never a replacement. Reads fall back field by
-- field: a coach who fills in only `description` leaves their clients seeing
-- the catalogue's image and YouTube link, not a stripped-down exercise. That is
-- why every content column is nullable and why there is no "is complete" flag —
-- null means "no opinion, use the catalogue", which is exactly what an absent
-- row means too.
--
--
-- ── What is not here ─────────────────────────────────────────────────────────
--
-- No per-coach `video_url`. The uploaded short clip stays shared: it is a
-- Supabase Storage object with its own cleanup paths in `ExercisesService`, an
-- on-device cache in the app keyed by URL, and a 100MB ceiling per file.
-- Duplicating it per coach multiplies storage for the one field coaches are
-- least likely to re-record. A coach who wants their own footage links it as
-- `youtube_url`.

create table if not exists public.exercise_coach_versions (
  exercise_id uuid not null
    references public.exercises(id) on delete cascade,

  -- The author. Deleting the coach's account takes their versions with it, and
  -- their clients fall back to the catalogue rather than reading a ghost.
  coach_id uuid not null
    references public."user"(id) on delete cascade,

  -- The coach's cues, in place of `exercises.description`.
  description text,

  -- A Supabase Storage object in the `images` bucket, same shape and bucket as
  -- `exercises.img_url`. Written only by the API, which compresses to WebP
  -- first and deletes the previous object when the coach replaces it.
  img_url text,

  -- The coach's link as they pasted it, trimmed — not a bare video id. Same
  -- validation as `exercises.youtube_url`: the API rejects anything it cannot
  -- extract an 11-character video id from, but keeps the original text so a
  -- `?t=90` start offset survives.
  youtube_url text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One version per coach per exercise. This is also the upsert target: the
  -- coach's editor sends the whole version and the API writes it with
  -- `on conflict (exercise_id, coach_id)`.
  primary key (exercise_id, coach_id)
);

comment on table public.exercise_coach_versions is
  'Per-coach override of a shared catalogue exercise, visible only to that '
  'coach and their approved clients. Reads fall back to public.exercises '
  'field by field; a null column means "use the catalogue".';


-- The coach's editor lists nothing by coach today, but every cleanup path does:
-- removing an exercise collects the version images to delete from storage, and
-- a coach's own version is looked up by both halves of the key. The primary key
-- already serves exercise-first lookups; this covers coach-first ones.

create index if not exists exercise_coach_versions_coach_id_idx
  on public.exercise_coach_versions (coach_id);


-- ── RLS: the author, and their approved clients ──────────────────────────────
--
-- Writes go through the backend's service-role key, which is where the YouTube
-- link is validated and the image uploaded, so there is no insert or update
-- policy here — a direct client write would skip both.
--
-- The select policy is the point of the feature: a coach reads their own rows,
-- and an athlete reads only the rows of a coach who has an approved relation to
-- them. Anyone else gets nothing, which is what "only visible to his students"
-- has to mean at the row level and not just in the API.

alter table public.exercise_coach_versions enable row level security;

drop policy if exists exercise_coach_versions_select_own
  on public.exercise_coach_versions;
create policy exercise_coach_versions_select_own
  on public.exercise_coach_versions
  for select
  to authenticated
  using (coach_id = auth.uid());

drop policy if exists exercise_coach_versions_select_client
  on public.exercise_coach_versions;
create policy exercise_coach_versions_select_client
  on public.exercise_coach_versions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.coach_user_relations r
      where r.coach_id = exercise_coach_versions.coach_id
        and r.user_id = auth.uid()
        and r.status = 'approved'
    )
  );


-- `updated_at` is maintained by the API on every upsert, so no trigger. The
-- column exists so a coach's editor can tell a stale draft from a fresh one and
-- so support can answer "when did this text change".


-- ── Verify ───────────────────────────────────────────────────────────────────
--
-- Expect zero rows immediately after running, then one row per exercise a coach
-- has actually written their own version of.

select count(*)                                          as versions,
       count(*) filter (where description is not null)    as with_text,
       count(*) filter (where img_url is not null)        as with_image,
       count(*) filter (where youtube_url is not null)    as with_youtube,
       count(distinct coach_id)                           as coaches
from public.exercise_coach_versions;
