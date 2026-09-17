-- exercises.muscle_group_2 — an optional second muscle group for an exercise
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Every statement is idempotent, so re-running is safe.
--
--
-- ── RUN THIS BEFORE DEPLOYING THE MATCHING API BUILD ─────────────────────────
--
-- The API build that ships with this file accepts `muscle_group_2` on
-- `POST /exercises/create` and `PUT /exercises/:id` and writes it straight to
-- the row. Without the column, both fail with
--
--   PGRST204  Could not find the 'muscle_group_2' column of 'exercises'
--
-- as soon as the app sends the field. Reads are unaffected — `findAll` selects
-- `*`. Nothing existing is touched (nullable, no default), so the file is safe
-- to run ahead of the deploy.
--
--
-- ── Why a second column and not an array ─────────────────────────────────────
--
-- An exercise has at most two groups, decided by the UI. `muscle_group` stays
-- the primary one, so every existing reader — plan editor, workout history,
-- monthly summary, the program draft prompt — keeps working unchanged. Same
-- reasoning as `img_url_2`.
--
--
-- ── What is stored ───────────────────────────────────────────────────────────
--
-- The same English value as `muscle_group` ("Chest", "Triceps", or a coach's
-- own text); the app translates the label. Null when the exercise has one group.

alter table public.exercises
  add column if not exists muscle_group_2 text;

comment on column public.exercises.muscle_group_2 is
  'Optional second muscle group, same values as muscle_group. Null when the '
  'exercise targets a single group; muscle_group stays the primary one.';


-- ── Verify ───────────────────────────────────────────────────────────────────

select count(*) filter (where muscle_group_2 is not null) as with_second,
       count(*)                                           as total
from public.exercises;
