-- Standalone cardio — let an athlete record cardio with no assigned workout.
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Both statements are idempotent, so re-running is safe.
--
-- Until now a cardio entry could only hang off a workout log, and a workout log
-- always belonged to a program day. An athlete on a rest day — or with no plan
-- at all — had nowhere to put the run they just did. Such a log now carries a
-- null `program_day_id`; it still points at the athlete's active program, so
-- AccessService keeps resolving its owner through
-- `user_workout_programs.user_id` exactly as before, and every read that joins
-- `user_program_days` already does so as a left join and simply gets a null
-- `day_name`.
--
-- Until this runs, POST /programs/workouts/cardio fails with
--   23502  null value in column "program_day_id" violates not-null constraint
-- and the app surfaces the plain "could not save cardio" toast.

alter table public.workout_logs
  alter column program_day_id drop not null;

comment on column public.workout_logs.program_day_id is
  'The planned day this session logs. Null for a session with no assigned '
  'workout — today only standalone cardio.';
