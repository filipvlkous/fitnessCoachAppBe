-- Photo scans: a per-user daily allowance and a pause after a cancelled scan.
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Every statement is idempotent, so re-running is safe.
--
-- ── RUN THIS BEFORE DEPLOYING THE MATCHING API BUILD ─────────────────────────
--
-- That build counts rows here before every `POST image-analysis/food/analyze`
-- and reads the two settings off the user. Without this file the scan fails
-- with "relation public.photo_scan_log does not exist".
--
-- Every scan that reaches Gemini is paid for, including one the athlete
-- cancels while it runs, so every one of them is a row here and counts toward
-- the day. Cancelling also pauses scanning for `photo_cooldown_minutes`, so
-- cancel-and-retake cannot be used to burn through the allowance.


alter table public."user"
  add column if not exists daily_photo_limit integer not null default 3,
  add column if not exists photo_cooldown_minutes integer not null default 5,
  -- Set by a cancelled scan; no scan is accepted before it.
  add column if not exists photo_cooldown_until timestamptz;

alter table public."user"
  drop constraint if exists user_daily_photo_limit_check;
alter table public."user"
  add constraint user_daily_photo_limit_check
  check (daily_photo_limit >= 0);

alter table public."user"
  drop constraint if exists user_photo_cooldown_minutes_check;
alter table public."user"
  add constraint user_photo_cooldown_minutes_check
  check (photo_cooldown_minutes >= 0);


create table if not exists public.photo_scan_log (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references public."user"(id) on delete cascade,

  -- The user's local calendar day (Europe/Prague) the scan is billed to.
  day date not null,

  created_at timestamptz not null default now()
);

comment on table public.photo_scan_log is
  'One row per photo sent to the AI. Counting a day''s rows enforces the '
  'user''s daily_photo_limit.';

-- "How many scans does this user have today", and the (created_at, id) order
-- that decides which of two simultaneous scans got the last slot.
create index if not exists photo_scan_log_user_day
  on public.photo_scan_log (user_id, day, created_at, id);


-- The API reads and writes this with the service-role key. No policy: nobody
-- reads it from the client.
alter table public.photo_scan_log enable row level security;
