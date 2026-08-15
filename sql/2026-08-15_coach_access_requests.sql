-- Coach access requests.
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Every statement is idempotent, so re-running is safe.
--
-- A coach who hits a locked section can ask the client to unlock it. The
-- request grants nothing by itself — it is a prompt, and the client's answer
-- goes through the consent ledger like every other consent decision.
--
-- The reason this table exists at all rather than just firing a notification:
-- an ask has to be rate limited, and a rate limit needs somewhere to remember
-- that the ask already happened.


create table if not exists public.coach_access_requests (
  id uuid primary key default gen_random_uuid(),

  -- Both cascade: a request is meaningless once either party is gone, and
  -- unlike the consent ledger there is nothing here worth keeping as evidence.
  -- The ledger already records what was actually decided.
  coach_id uuid not null
    references public."user"(id) on delete cascade,
  client_id uuid not null
    references public."user"(id) on delete cascade,

  scope text not null,
  status text not null default 'pending',

  created_at timestamptz not null default now(),
  resolved_at timestamptz,

  -- An ignored request is an answer. It stops appearing for the client and
  -- frees the coach to ask again later, rather than sitting there forever.
  expires_at timestamptz not null default now() + interval '14 days',

  constraint coach_access_requests_scope_check
    check (scope in ('workouts', 'nutrition', 'bodyMetrics')),

  constraint coach_access_requests_status_check
    check (status in ('pending', 'granted', 'declined', 'expired')),

  -- Asking yourself is not a thing.
  constraint coach_access_requests_distinct_parties
    check (coach_id <> client_id)
);

comment on table public.coach_access_requests is
  'A coach asking a client to unlock one data scope. Grants nothing on its own: '
  'the client''s answer is recorded in user_consent_events like any other consent.';

-- The anti-nagging rule, in the schema rather than the service.
--
-- Consent obtained by pestering is not freely given, so "one open ask per coach
-- per client per scope" has to be structurally impossible to violate, not merely
-- checked before an insert where a race could slip past it.
create unique index if not exists coach_access_requests_one_open
  on public.coach_access_requests (coach_id, client_id, scope)
  where status = 'pending';

-- Serves the client's "what am I being asked" query.
create index if not exists coach_access_requests_client_pending_idx
  on public.coach_access_requests (client_id, status, expires_at desc);

-- Serves the cooldown lookup on the coach side.
create index if not exists coach_access_requests_cooldown_idx
  on public.coach_access_requests (coach_id, client_id, scope, resolved_at desc);


-- ── Row level security ───────────────────────────────────────────────────────
--
-- Writes go through the backend's service-role key, which is where the
-- "is this coach actually connected to this client" check runs. The policies
-- below only cover direct client reads.

alter table public.coach_access_requests enable row level security;

drop policy if exists coach_access_requests_select_own on public.coach_access_requests;
create policy coach_access_requests_select_own
  on public.coach_access_requests
  for select
  to authenticated
  using (client_id = auth.uid() or coach_id = auth.uid());
