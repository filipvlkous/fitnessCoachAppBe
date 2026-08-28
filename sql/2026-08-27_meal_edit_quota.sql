-- meal_edit_log — the ledger behind "three food edits a day"
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Every statement is idempotent, so re-running is safe.
--
--
-- ── RUN THIS BEFORE DEPLOYING THE MATCHING API BUILD ─────────────────────────
--
-- The API build that ships with this file writes a row here before every meal
-- edit or removal (`MacrosService.updateMeal` / `deleteMeal`) and counts the
-- day's rows to decide whether the user has any changes left
-- (`getMealEditQuota`). Without the table both endpoints fail with
--
--   42P01  relation "public.meal_edit_log" does not exist
--
-- and the app shows the food history with its edit controls permanently
-- disabled. Nothing already logged is at risk — meal logging never touches
-- this table — so the file is safe to run well ahead of the deploy.
--
--
-- ── Why a ledger rather than a counter ───────────────────────────────────────
--
-- A `meal_edits_today integer` column on the user would need a reset job, and a
-- reset job that does not run hands out an unlimited allowance or none at all.
-- Rows keyed by the day have no such failure mode: the day's allowance is
-- however many rows carry that date, and yesterday's rows simply stop being
-- counted when the date rolls over.
--
-- Keeping the rows also answers "what did this user change, and when" — the
-- meal itself is rewritten in place, so without this there is no trace at all
-- that a 900 kcal dinner used to be logged as 1900.
--
-- The day is stored, not derived from `created_at`, because the cutoff is the
-- user's own midnight in Europe/Prague (`utils/getLocalTime.localDateStr`) and
-- `created_at` is UTC — deriving it would move the boundary by two hours in
-- summer and hand out a fourth edit at 23:00.


create table if not exists public.meal_edit_log (
  id uuid primary key default gen_random_uuid(),

  -- Whose allowance was spent. Cascades: the ledger is a rate limit, not
  -- evidence, so it has no reason to outlive the account.
  user_id uuid not null
    references public."user"(id) on delete cascade,

  -- Which meal was touched. Deliberately NOT a foreign key: a removal's whole
  -- point is that the meal is gone a moment later, and an FK would either
  -- refuse the delete or (on cascade) erase the record of it. Text rather than
  -- uuid for the same reason — nothing here is ever joined back to `meals`, so
  -- this stays a plain copy of the id that cannot be broken by that table's
  -- key type. Null only for a change that touched no single meal.
  meal_id text,

  action text not null,

  -- The user's local calendar day, as "YYYY-MM-DD". The allowance is per day
  -- and this is the day it was billed to.
  day date not null,

  created_at timestamptz not null default now(),

  constraint meal_edit_log_action_check
    check (action in ('edit', 'delete'))
);

comment on table public.meal_edit_log is
  'One row per meal edit or removal. Counting a day''s rows is what enforces '
  'the three-changes-a-day allowance; the rows double as the only record that '
  'a logged meal was altered after the fact.';

-- The only query that runs against this table: "how many rows does this user
-- have for this day". Ordering by (created_at, id) inside the day is what
-- decides which requests won a contested allowance, so both are in the index.
create index if not exists meal_edit_log_user_day
  on public.meal_edit_log (user_id, day, created_at, id);


-- ── Row level security ───────────────────────────────────────────────────────
--
-- Only the backend's service-role key writes here, and deliberately so: a
-- ledger the client can insert into is a rate limit the client can also delete
-- its way out of. No insert, update or delete policy is defined, so an
-- authenticated user gets exactly one thing — the ability to read their own
-- record of what they changed.

alter table public.meal_edit_log enable row level security;

drop policy if exists meal_edit_log_select_own on public.meal_edit_log;
create policy meal_edit_log_select_own
  on public.meal_edit_log
  for select
  to authenticated
  using (user_id = auth.uid());


-- ── Verify ───────────────────────────────────────────────────────────────────
--
-- Expect zero rows on a fresh install, then at most three per user per day.

select user_id, day, count(*) as changes
from public.meal_edit_log
group by user_id, day
having count(*) > 3
order by day desc;
