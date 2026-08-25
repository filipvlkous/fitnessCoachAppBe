-- Restore `user_workout_programs.coach_id`.
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Every statement is idempotent, so re-running is safe.
--
-- The column is missing from the database while both the API and the app assume
-- it exists, so a coach accepting a client fails at the point it matters:
--
--   * `approveUser` inserts the client's first program with `coach_id` on it.
--     The insert errors with 42703, the endpoint answers 500, and the client
--     list rolls the athlete back to "pending" — after the relation row has
--     already been flipped to `approved`. The athlete is accepted in the
--     database and rejected on both screens.
--   * `createSoloProgram` inserts `coach_id: null`, so training without a coach
--     fails the same way.
--   * `getActiveProgram` selects the column, so the athlete's home screen gets
--     nothing back for their plan.
--   * The app reads a program with no `coach_id` as one the athlete wrote
--     themselves (`isSoloProgram`), so a coach's plan renders as "MŮJ PLÁN"
--     with an Edit button.
--
-- Nullable, because `2026-08-22_solo_programs.sql` defines a solo program as
-- one with `coach_id is null`. That migration assumed the column was there and
-- only dropped its NOT NULL, which is why it did not put it back.

-- 1. The column, pointing at the coach who owns the plan.
alter table user_workout_programs
  add column if not exists coach_id uuid references "user" (id) on delete set null;

-- 2. Coach queries filter on it.
create index if not exists user_workout_programs_coach_id_idx
  on user_workout_programs (coach_id);

-- 3. Backfill. Every existing program was created by the approval flow — the
--    solo endpoint has never been able to insert a row — so an athlete's
--    approved coach is the right owner for it. Skip this statement if any
--    coach-less program has since been created on purpose.
update user_workout_programs p
   set coach_id = r.coach_id
  from coach_user_relations r
 where r.user_id = p.user_id
   and r.status = 'approved'
   and p.coach_id is null;
