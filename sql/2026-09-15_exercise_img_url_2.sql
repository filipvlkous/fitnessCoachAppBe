-- exercises.img_url_2 — a second demonstration photo, swiped through in the app
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Every statement is idempotent, so re-running is safe.
--
--
-- ── This column may already exist ────────────────────────────────────────────
--
-- It was reported as already added by hand before this file was written, which
-- is why the file is a no-op in that case: `add column if not exists` leaves an
-- existing column and its data untouched, and the comment is simply rewritten.
-- It is here so `sql/` stays a complete record of the schema and so a fresh or
-- staging database can be brought up to the same shape.
--
--
-- ── RUN THIS BEFORE DEPLOYING THE MATCHING API BUILD ─────────────────────────
--
-- The API build that ships with this file selects this column in
-- `ExercisesService.getMedia`, `remove` and `deleteMedia`, and writes it in
-- `uploadMedia`. Without it, opening any exercise fails with
--
--   42703  column exercises.img_url_2 does not exist
--
-- and both the coach's exercise detail screen and the user's workout logger
-- lose their media sections entirely. Nothing existing is touched — the column
-- is added nullable with no default — so the file is safe to run ahead of the
-- deploy: older API builds never select it.
--
--
-- ── Why a second column and not an array or a child table ────────────────────
--
-- The gallery is exactly two pictures, decided by the UI: a coach gets two
-- slots in the editor and the athlete swipes between them. A `text[]` or an
-- `exercise_images` table would model an unbounded list nobody asked for, and
-- every existing code path — `parseStorageLocation`, the cleanup in `remove`,
-- the per-slot delete — already works one URL at a time. If the gallery ever
-- needs to grow, that is the point to normalise it, not before.
--
--
-- ── How it interacts with a coach's own version ──────────────────────────────
--
-- `exercise_coach_versions` deliberately does NOT gain this column. A coach's
-- private version has a single image slot, and `resolveExerciseForViewer`
-- treats their picture as replacing the catalogue gallery rather than joining
-- it — so a client never swipes from their coach's photo onto a catalogue one
-- the coach did not choose and cannot remove.
--
--
-- ── What is stored ───────────────────────────────────────────────────────────
--
-- The public URL of a Supabase Storage object in the `images` bucket, written
-- by `uploadMedia` after the image is re-encoded to WebP — the same shape as
-- `img_url`. The two slots are independent: either may be filled while the
-- other is null, and clearing the first does not shuffle the second down.

alter table public.exercises
  add column if not exists img_url_2 text;

comment on column public.exercises.img_url_2 is
  'Second demonstration image for this exercise, as a public Supabase Storage '
  'URL in the images bucket. Independent of img_url: either slot may be null. '
  'The app shows both as one swipeable gallery.';


-- ── Verify ───────────────────────────────────────────────────────────────────
--
-- Expect with_second to be 0 immediately after running on a database that did
-- not have the column, then to grow as coaches add second pictures.
--
-- orphaned_second counts rows holding a second image with no first image. That
-- is a legal state (the coach removed slot 1 and kept slot 2) and the app
-- renders it as a one-picture gallery, so a non-zero count is not a fault.

select count(*) filter (where img_url   is not null)                       as with_first,
       count(*) filter (where img_url_2 is not null)                       as with_second,
       count(*) filter (where img_url_2 is not null and img_url is null)   as orphaned_second,
       count(*)                                                            as total
from public.exercises;
