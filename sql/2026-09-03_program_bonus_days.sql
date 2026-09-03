-- Bonus training days — a program week that can hold more than seven workouts.
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Every statement is idempotent, so re-running is safe.
--
-- Until now a program day was a weekday: `day_number` 1 (Monday) … 7 (Sunday),
-- one row per slot. A coach who wants to give a client an extra session — a
-- second leg day, a conditioning block — had nowhere to put it. Numbers above 7
-- are those extras: day 8 is "Bonus 1", day 9 "Bonus 2". They are not bound to
-- a calendar day; the client trains them whenever they fit.
--
-- 14 is the ceiling (seven weekdays + seven bonuses). It exists because the
-- assign DTO needs an upper bound at all, not because the app has a reason to
-- stop there. `MAX_PROGRAM_DAY_NUMBER` names the same number on both sides —
-- `src/coach-plans/coach-plans.service.ts` and `utils/programDays.ts` in the app.
--
-- Presets are deliberately NOT part of this: `coach_program_preset_days` keeps
-- its 1–7 check, so a saved week stays a week. Assigning one also leaves bonus
-- days alone — `assignPresetToStudent` only looks for collisions on the day
-- numbers its own slots use.

-- 0. What is actually on the table right now. The original schema predates this
--    directory, so the check may be named anything — or not exist at all, in
--    which case step 1 is a no-op and nothing was ever blocking day 8.
--
--    select conname, pg_get_constraintdef(oid)
--      from pg_constraint
--     where conrelid = 'public.user_program_days'::regclass
--       and contype = 'c';

-- 1. Drop the weekday-only check under the name Postgres gives an inline
--    `check (day_number between 1 and 7)`. If step 0 showed another name, drop
--    that one too — a leftover 1–7 check still refuses day 8.
alter table public.user_program_days
  drop constraint if exists user_program_days_day_number_check;

-- 2. Re-add it with the bonus range. Named, so the next person to widen it can
--    find it, and so this file can be re-run.
alter table public.user_program_days
  drop constraint if exists user_program_days_day_number_range;

alter table public.user_program_days
  add constraint user_program_days_day_number_range
  check (day_number between 1 and 14);
