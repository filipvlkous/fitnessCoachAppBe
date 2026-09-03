-- Remembering that a session was already reminded about.
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Every statement is idempotent, so re-running is safe.
--
-- Between "the coach approved" and the session itself, nothing was said. The
-- approval push can be days old by then, which is exactly the gap a reminder
-- fills.
--
-- The column is what makes the reminder job safe to run repeatedly. A restart,
-- an overlapping tick, or a second backend instance would otherwise all re-send
-- the same push, and "your session starts soon" arriving three times is worse
-- than it not arriving at all. The job claims rows by writing this column in
-- the same statement that selects them, so a row can only be claimed once.

alter table public.gym_meetings
  add column if not exists reminded_at timestamptz;

comment on column public.gym_meetings.reminded_at is
  'When the pre-session reminder was sent. Also set at approval time when the '
  'meeting is already inside the reminder window — that approval is the '
  'reminder. Null means the reminder is still owed.';


-- The reminder job's only query: approved sessions starting soon that nobody
-- has been told about yet.
--
-- Partial on both conditions, so the index holds just the handful of sessions
-- still owed a reminder rather than every meeting ever booked — a claimed row
-- drops out of it as soon as the job writes reminded_at.
create index if not exists gym_meetings_reminder_idx
  on public.gym_meetings (starts_at)
  where status = 'approved' and reminded_at is null;
