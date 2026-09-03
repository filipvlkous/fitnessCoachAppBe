-- When a coach accepts session requests, stored on gym_meetings itself.
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Every statement is idempotent, so re-running is safe.
--
-- Before this, a client picking a slot was guessing: the picker offered every
-- hour of every day and the coach declined the ones that did not work. An
-- availability row is the coach's standing answer to "when may I ask?", and the
-- client's app builds its slot grid out of them.
--
-- These rows live in `gym_meetings` under status 'availability' rather than in
-- a table of their own. They are a different kind of thing from a meeting — no
-- client, no instant, recurring every week — so the columns a meeting needs are
-- null on them and the columns they need are null on a meeting. The pair of
-- shape constraints at the bottom is what keeps that from becoming a table
-- where anything may be null: each status is allowed exactly its own shape.


-- ── Columns ──────────────────────────────────────────────────────────────────

alter table public.gym_meetings
  -- An availability row is the coach on their own. Meetings still require a
  -- client; that is now enforced by gym_meetings_client_required below.
  alter column client_id drop not null,
  -- Likewise: a recurring weekly window has no single instant.
  alter column starts_at drop not null;

alter table public.gym_meetings
  -- 0 = Sunday, matching JS getDay() so neither side has to remap.
  add column if not exists weekday smallint,
  -- Minutes from midnight in COACH_TZ (Europe/Prague). Not `time` columns: the
  -- app works in minutes when it slices a window into slots, and a round trip
  -- through `time` would only add parsing at both ends.
  add column if not exists starts_minute smallint,
  add column if not exists ends_minute smallint;


-- ── Constraints ──────────────────────────────────────────────────────────────
-- Dropped and re-added rather than altered, which is also what makes re-running
-- this file safe.

alter table public.gym_meetings
  drop constraint if exists gym_meetings_status_check;
alter table public.gym_meetings
  add constraint gym_meetings_status_check
  check (status in (
    'pending', 'proposed', 'approved', 'declined', 'cancelled', 'availability'
  ));

-- A meeting with yourself is still not a thing; an availability row simply has
-- nobody on the other side.
alter table public.gym_meetings
  drop constraint if exists gym_meetings_distinct_parties;
alter table public.gym_meetings
  add constraint gym_meetings_distinct_parties
  check (client_id is null or coach_id <> client_id);

-- The NOT NULLs given up above, given back per status. Written as an equality
-- so it cuts both ways: a meeting without a client is refused, and so is an
-- availability row that carries one.
alter table public.gym_meetings
  drop constraint if exists gym_meetings_client_required;
alter table public.gym_meetings
  add constraint gym_meetings_client_required
  check ((status = 'availability') = (client_id is null));

alter table public.gym_meetings
  drop constraint if exists gym_meetings_starts_at_required;
alter table public.gym_meetings
  add constraint gym_meetings_starts_at_required
  check ((status = 'availability') = (starts_at is null));

-- An availability row carries a whole window and nothing else. A window that
-- wraps past midnight is rejected rather than split: nobody trains at 3am, and
-- allowing it would make every slot calculation on the client handle a range
-- whose end is before its start.
--
-- The three `is not null` tests are load-bearing, not decoration. A CHECK is
-- satisfied when its expression is TRUE *or NULL*, so with a null weekday the
-- range test alone would evaluate to NULL, `false or NULL` would be NULL, and
-- a windowless availability row would be accepted. `x is not null` is never
-- NULL, and false ANDed with anything is false, which is what makes the whole
-- disjunction come out false instead.
alter table public.gym_meetings
  drop constraint if exists gym_meetings_availability_shape;
alter table public.gym_meetings
  add constraint gym_meetings_availability_shape
  check (
    status <> 'availability'
    or (
      weekday is not null
      and starts_minute is not null
      and ends_minute is not null
      and weekday between 0 and 6
      and starts_minute between 0 and 1439
      -- 1440 is midnight at the end of the day, so a window may close on it.
      and ends_minute between 1 and 1440
      and ends_minute > starts_minute
    )
  );

-- And the mirror, so the window columns cannot quietly collect values on rows
-- that are meetings.
alter table public.gym_meetings
  drop constraint if exists gym_meetings_meeting_shape;
alter table public.gym_meetings
  add constraint gym_meetings_meeting_shape
  check (
    status = 'availability'
    or (weekday is null and starts_minute is null and ends_minute is null)
  );


-- ── Index ────────────────────────────────────────────────────────────────────
-- The only read there is: every window for one coach. Partial, so it stays out
-- of the way of the meeting indexes.

create index if not exists gym_meetings_availability_idx
  on public.gym_meetings (coach_id, weekday, starts_minute)
  where status = 'availability';


-- RLS needs nothing new: gym_meetings_select_own already reads
-- `client_id = auth.uid() or coach_id = auth.uid()`, and with a null client
-- that leaves the coach as the only direct reader of their own windows.
-- Clients reach them through GET /meetings/availability/:coachId, which checks
-- the coach-client relation first.
