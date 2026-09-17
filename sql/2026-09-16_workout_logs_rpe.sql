-- workout_logs.rpe — how hard the athlete rated the whole session, 1-10
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Every statement is idempotent, so re-running is safe.
--
--
-- ── RUN THIS BEFORE DEPLOYING THE MATCHING API BUILD ─────────────────────────
--
-- The API build that ships with this file writes the column in
-- `PUT /programs/workouts/:id/rpe`. Without it that call fails with
--
--   PGRST204  Could not find the 'rpe' column of 'workout_logs'
--
-- and the athlete's rating is lost (the app queues it and keeps retrying only
-- on network errors). The coach feed reads the column in a separate query and
-- simply leaves RPE off the cards while it is missing. Nothing existing is
-- touched (nullable, no default), so the file is safe to run ahead of the
-- deploy.
--
--
-- ── Why on the workout log and not per set ───────────────────────────────────
--
-- The athlete is asked once, after finishing: "how hard was it?". That is a
-- session RPE, a property of the workout. `exercise_logs` has no rpe column
-- either, although the set DTO has long accepted one; it was never stored.
--
--
-- ── What is stored ───────────────────────────────────────────────────────────
--
-- An integer 1-10, or null when the athlete skipped the question or finished
-- before this existed. The app offers 6-10; the check allows the whole scale.

alter table public.workout_logs
  add column if not exists rpe smallint
  check (rpe between 1 and 10);

comment on column public.workout_logs.rpe is
  'Session RPE the athlete gave after finishing, 1-10. Null when skipped.';


-- ── Verify ───────────────────────────────────────────────────────────────────

select count(*) filter (where rpe is not null) as rated,
       count(*)                                as total
from public.workout_logs;
