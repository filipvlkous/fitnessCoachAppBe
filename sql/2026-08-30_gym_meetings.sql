-- Gym meetings between a coach and their client.
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Every statement is idempotent, so re-running is safe.
--
-- The client asks for a slot, the coach answers. The answer is not only
-- yes/no: a coach who is busy at that hour can put a different time back to
-- the client, who then confirms it. That third answer is why this is a table
-- with a status rather than a pair of booleans — the row has to remember whose
-- turn it is.


create table if not exists public.gym_meetings (
  id uuid primary key default gen_random_uuid(),

  -- Both cascade: a meeting between two people is meaningless once either is
  -- gone, and unlike the consent ledger there is nothing here worth keeping.
  coach_id uuid not null
    references public."user"(id) on delete cascade,
  client_id uuid not null
    references public."user"(id) on delete cascade,

  -- The agreed time while approved; the client's original ask before that.
  -- A coach counter-proposal lands in proposed_starts_at and only moves here
  -- once the client confirms, so a pending counter-proposal never overwrites
  -- what the two sides last actually agreed on.
  starts_at timestamptz not null,
  duration_minutes integer not null default 60,

  -- Free text rather than a reference to the coach's gym: coaches move, and a
  -- meeting that already happened should keep saying where it happened.
  location text,
  note text,

  status text not null default 'pending',

  -- Set only while status = 'proposed'.
  proposed_starts_at timestamptz,

  -- Why the request was turned down, shown to the other side. Optional: a
  -- decline is a valid answer on its own and nobody owes an explanation.
  decline_reason text,

  -- Who ended it, for the "cancelled by your coach" vs "by your client" copy.
  cancelled_by uuid references public."user"(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,

  constraint gym_meetings_status_check
    check (status in ('pending', 'proposed', 'approved', 'declined', 'cancelled')),

  -- A meeting with yourself is not a thing.
  constraint gym_meetings_distinct_parties
    check (coach_id <> client_id),

  -- Bounds rather than a free integer: the app offers a picker, and a stored
  -- 100000-minute session is a bug that would reach the calendar of both
  -- parties before anyone noticed.
  constraint gym_meetings_duration_check
    check (duration_minutes between 15 and 240),

  -- 'proposed' means "there is a counter-offer waiting", so the counter-offer
  -- has to exist. Enforced here because the app reads this column to decide
  -- which time to show the client.
  constraint gym_meetings_proposed_has_time
    check (status <> 'proposed' or proposed_starts_at is not null)
);

comment on table public.gym_meetings is
  'In-person training sessions: the client asks, the coach approves, declines '
  'or proposes another time for the client to confirm.';


-- One open negotiation per pair, in the schema rather than the service.
--
-- Without it a client can queue up ten pending asks faster than a coach can
-- answer one, and each ask is a push notification. Approved meetings are
-- deliberately outside the index: a real schedule has several of them.
create unique index if not exists gym_meetings_one_open
  on public.gym_meetings (coach_id, client_id)
  where status in ('pending', 'proposed');

-- Serves each side's "what is coming up / what is waiting for me" query.
create index if not exists gym_meetings_coach_idx
  on public.gym_meetings (coach_id, status, starts_at);

create index if not exists gym_meetings_client_idx
  on public.gym_meetings (client_id, status, starts_at);


-- ── Row level security ───────────────────────────────────────────────────────
--
-- Writes go through the backend's service-role key, which is where the
-- "is this coach actually connected to this client" and whose-turn-is-it
-- checks run. The policy below only covers direct client reads.

alter table public.gym_meetings enable row level security;

drop policy if exists gym_meetings_select_own on public.gym_meetings;
create policy gym_meetings_select_own
  on public.gym_meetings
  for select
  to authenticated
  using (client_id = auth.uid() or coach_id = auth.uid());
