-- Solo programs — let an athlete train without a coach.
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Both statements are idempotent, so re-running is safe.
--
-- Until now every program and every workout log carried a coach. The app only
-- ever created them from the coach's client screen, so the columns were never
-- allowed to be null. A user who trains on their own has no coach to put there,
-- and the alternative — pointing the column at themselves — would make them
-- their own coach in `coach_user_relations` reads and in the coach feed.
--
-- Nothing else has to change for authorization: AccessService resolves every
-- program, day, assigned exercise and log through `user_workout_programs.user_id`,
-- never through `coach_id`, so a coach-less row is reachable by its owner and by
-- nobody else. `completeWorkout` already looks the coach up from
-- `coach_user_relations` and skips the push when there is none, and every coach
-- query filters with `.eq('coach_id', …)`, which never matches a null.


-- 1. The program itself. A solo program is one with `coach_id is null`.
alter table user_workout_programs
  alter column coach_id drop not null;

-- 2. Workout logs. `coach_id` here is a denormalized copy of whoever owned the
--    program when the session started; solo sessions leave it empty.
alter table workout_logs
  alter column coach_id drop not null;
