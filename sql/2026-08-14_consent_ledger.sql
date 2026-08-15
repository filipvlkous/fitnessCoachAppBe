-- Consent ledger + server-side age gate.
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Every statement is idempotent, so re-running is safe.
--
-- Why a ledger and not a column: GDPR Art. 7(1) requires the controller to be
-- able to *demonstrate* consent, and Art. 7(3) gives the right to withdraw it.
-- An updatable "analytics boolean" answers neither question — it cannot show
-- that consent was ever given, nor when it was taken back. One immutable row
-- per decision can.


-- ── 1. Consent state on the user record ──────────────────────────────────────
--
-- date_of_birth is what makes the age gate real. The app also checks it, but an
-- app-side check is a UX shortcut, not an enforcement point: anyone talking to
-- the API directly walks straight past it.

alter table public."user"
  add column if not exists date_of_birth date,
  add column if not exists consent_terms_version text,
  add column if not exists consent_policy_version text,
  add column if not exists consent_updated_at timestamptz;

comment on column public."user".date_of_birth is
  'Declared date of birth. Enforced server-side in UserService.saveConsents: '
  'below 15 (§ 7 z. c. 110/2019 Sb.) consent is refused and nothing is stored.';

comment on column public."user".consent_policy_version is
  'Privacy policy version of the last full acceptance. A bump here is what '
  'sends existing users back through the consent screen.';


-- ── 2. The ledger ────────────────────────────────────────────────────────────

create table if not exists public.user_consent_events (
  id uuid primary key default gen_random_uuid(),

  -- Deliberately NOT a foreign key to public."user". The ledger has to outlive
  -- the account: the point of keeping it is to answer "did this person consent,
  -- and when did they withdraw?", which is a question that mostly gets asked
  -- after someone has left. A cascade would also fight the append-only trigger
  -- below. See the retention note at the bottom.
  user_id uuid not null,

  -- 'consent'    — the four top-level consents from the consent screen.
  -- 'coachScope' — which slices of data a connected coach may read. These live
  --                under the coachSharing consent rather than beside it: a
  --                granted scope means nothing while coachSharing is off, and
  --                anything deriving access has to AND the two together.
  kind text not null,
  consent_key text not null,
  granted boolean not null,

  -- decided_at is the user's clock (when they tapped), recorded_at is ours
  -- (when it reached the server). They differ whenever the app was offline, and
  -- the gap is worth keeping rather than collapsing into one column.
  decided_at timestamptz not null,
  recorded_at timestamptz not null default now(),

  -- The document versions this particular decision was made against. Consent to
  -- v1.0.0 is not consent to v2.0.0, so the version travels with the row.
  policy_version text not null,
  terms_version text,

  -- The vocabulary belongs in the schema as well as the DTO: this is the table
  -- an auditor reads, and it should say what the app is allowed to record.
  constraint user_consent_events_key_check check (
    (kind = 'consent' and consent_key in (
      'healthData', 'coachSharing', 'analytics', 'marketing'
    ))
    or (kind = 'coachScope' and consent_key in (
      'workouts', 'nutrition', 'bodyMetrics'
    ))
  )
);

comment on table public.user_consent_events is
  'Append-only consent ledger (GDPR Art. 7). One row per decision. Withdrawal '
  'is a new row with granted = false, never an edit of an existing row.';

-- The app retries a failed sync on every start, and each retry replays the same
-- decisions. Without this, one flaky network week would bury the real history
-- under thousands of identical rows. A repeat of a decision we already hold is
-- the same fact, so it collapses to a no-op (the service upserts with
-- ignoreDuplicates against exactly this constraint).
create unique index if not exists user_consent_events_dedupe
  on public.user_consent_events (user_id, kind, consent_key, decided_at);

-- Serves the current-state view and any per-user history read.
create index if not exists user_consent_events_user_key_idx
  on public.user_consent_events (user_id, kind, consent_key, decided_at desc);


-- ── 3. Append-only enforcement ───────────────────────────────────────────────
--
-- Three layers, because they cover different holes:
--   * the trigger stops UPDATE/DELETE even for service_role, which is the key
--     the backend actually uses and which bypasses RLS entirely;
--   * the REVOKE stops TRUNCATE, which row-level triggers never see;
--   * RLS keeps the anon/authenticated clients read-only on their own rows.

create or replace function public.user_consent_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'user_consent_events is append-only (attempted %). Record a withdrawal as a new row.',
    tg_op;
end;
$$;

drop trigger if exists user_consent_events_no_mutation on public.user_consent_events;
create trigger user_consent_events_no_mutation
  before update or delete on public.user_consent_events
  for each row execute function public.user_consent_events_append_only();

revoke update, delete, truncate on public.user_consent_events
  from anon, authenticated, service_role;

alter table public.user_consent_events enable row level security;

-- Read-your-own only. There is no insert/update/delete policy on purpose:
-- writes go through the backend's service-role key, which is the only place the
-- age gate runs.
drop policy if exists user_consent_events_select_own on public.user_consent_events;
create policy user_consent_events_select_own
  on public.user_consent_events
  for select
  to authenticated
  using (user_id = auth.uid());


-- ── 4. Current state ─────────────────────────────────────────────────────────
--
-- The ledger is the truth; this view is the convenient projection of it — the
-- latest decision per key. Kept in SQL rather than reduced in the service so a
-- GET stays one bounded read no matter how long a user's history gets.

create or replace view public.user_consents_current
with (security_invoker = true) as
select distinct on (user_id, kind, consent_key)
  user_id,
  kind,
  consent_key,
  granted,
  decided_at,
  recorded_at,
  policy_version,
  terms_version
from public.user_consent_events
-- recorded_at and id break ties so the "latest" row is deterministic even if a
-- client sends two decisions with an identical timestamp.
order by user_id, kind, consent_key, decided_at desc, recorded_at desc, id desc;

comment on view public.user_consents_current is
  'Latest decision per (user, kind, key). Read model over user_consent_events. '
  'Note that a coachScope row granted = true still means no access while the '
  'coachSharing consent is off — consumers must AND the two.';


-- ── Retention note ───────────────────────────────────────────────────────────
--
-- Account deletion (UserService.deleteUser) removes the auth user and the
-- public."user" row, including date_of_birth. It does NOT touch this table, and
-- the trigger above would refuse if it tried. What survives is a user_id, a
-- handful of booleans and their timestamps — no name, no email, no health data
-- — kept to evidence that consent was obtained and honoured. That is the usual
-- position for consent records, but it is a retention decision: if it should
-- instead be purged after some period, add a scheduled job that drops rows past
-- that age, and it will need to run as a role exempted from the trigger.
