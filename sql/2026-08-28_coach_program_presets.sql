-- Program presets — a reusable training *week*, built out of day plans.
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Every statement is idempotent, so re-running is safe.
--
-- `coach_workout_plans` is a one-day template: a named list of exercises the
-- coach drops onto a single weekday of a client's program. A preset sits one
-- level above it — "Push / Pull / Legs", "Beginner 3×week" — and names which
-- day plan belongs on which weekday. Assigning a preset copies every one of its
-- day plans into the client's program in a single step.
--
-- Same snapshot model as day plans: assigning copies exercises into
-- `user_assigned_exercises`, so editing a preset (or the day plans inside it)
-- never rewrites a week a client is already training on.

-- 1. The preset itself.
create table if not exists coach_program_presets (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references "user" (id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists coach_program_presets_coach_id_idx
  on coach_program_presets (coach_id);

-- 2. Its slots: one day plan per weekday.
--
--    `plan_id` cascades on delete — deleting a day plan removes it from every
--    preset that referenced it, rather than leaving a slot pointing at nothing.
--    Weeks already assigned to clients are unaffected: those are copies.
create table if not exists coach_program_preset_days (
  id uuid primary key default gen_random_uuid(),
  preset_id uuid not null references coach_program_presets (id) on delete cascade,
  plan_id uuid not null references coach_workout_plans (id) on delete cascade,
  -- 1 = Monday … 7 = Sunday, matching `user_program_days.day_number`.
  day_number smallint not null check (day_number between 1 and 7),
  week_number smallint not null default 1,
  -- Overrides the day plan's name for this slot; null keeps the plan's own.
  day_name text,
  created_at timestamptz not null default now(),
  -- The recurring-week calendar renders one day per weekday chip, so a preset
  -- must not describe two workouts for the same slot.
  unique (preset_id, week_number, day_number)
);

create index if not exists coach_program_preset_days_preset_id_idx
  on coach_program_preset_days (preset_id);

create index if not exists coach_program_preset_days_plan_id_idx
  on coach_program_preset_days (plan_id);
