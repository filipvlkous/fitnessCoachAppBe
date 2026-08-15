-- Birth date consolidation: user_profile.age  →  user.date_of_birth
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it in the Supabase SQL editor.
--
--
-- ── The problem ──────────────────────────────────────────────────────────────
--
-- The same fact is stored twice, in two tables, under two names:
--
--   user_profile.age     date   the profile's birth date. The column is named
--                               "age" but holds a date — which is why the app
--                               carries a parseISODate() helper with a comment
--                               about "legacy numeric age values". The name
--                               lies about the contents.
--
--   user.date_of_birth   date   added by 2026-08-14_consent_ledger.sql. This is
--                               the one UserService.saveConsents enforces the
--                               § 7 z. c. 110/2019 Sb. age gate against.
--
-- Two copies of a birth date can disagree, and one of them decides whether a
-- person is old enough to consent. We keep user.date_of_birth: correctly named,
-- correctly typed, and already the column that matters.
--
--
-- ── Read this before running anything ────────────────────────────────────────
--
-- This file is in TWO PHASES and they are NOT run at the same time.
--
--   PHASE 1  backfill + verify. Non-destructive. Safe to run now, safe to
--            re-run, safe to leave in place indefinitely. Nothing reads the
--            new state until the application code is updated.
--
--   PHASE 2  drops user_profile.age. IRREVERSIBLE. Only after the application
--            code writes and reads user.date_of_birth, and has been running
--            long enough that you would have noticed a missed read path.
--
-- Running Phase 2 early loses the birth date of every account that predates the
-- consent screen, because those users have their date ONLY in user_profile.age.
-- Splitting the phases means a missed read path shows stale data, which is a
-- one-line revert, instead of losing data, which is a restore from backup.


-- ═════════════════════════════════════════════════════════════════════════════
--  PHASE 1 — run now
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Step 1.1 · Survey before touching anything ───────────────────────────────
--
-- Run this first and keep the numbers. `needing_backfill` is what Step 1.2 will
-- fix; `conflicting` is the only figure that needs a human decision.

select
  count(*) filter (where up.age is not null)
    as profiles_with_birth_date,
  count(*) filter (where u.date_of_birth is not null)
    as users_with_date_of_birth,
  count(*) filter (where up.age is not null and u.date_of_birth is null)
    as needing_backfill,
  count(*) filter (
    where up.age is not null
      and u.date_of_birth is not null
      and up.age <> u.date_of_birth
  ) as conflicting
from public."user" u
left join public.user_profile up on up.user_id = u.id;


-- ── Step 1.2 · Inspect the conflicts ─────────────────────────────────────────
--
-- Rows where both columns hold a date and the dates disagree. Expected to be
-- empty or near-empty: it only happens where someone edited their birthday in
-- the profile after consenting, since that write never touched date_of_birth.
--
-- These are NOT auto-resolved. date_of_birth wins by design — it is what the
-- person declared at the moment they consented and what the age gate verified.
-- The profile value is the unverified one, and it disappears in Phase 2.
--
-- If any row here looks like the profile value is the correct one, fix that
-- single row by hand with Step 1.3 before continuing.

select
  u.id                as user_id,
  u.date_of_birth     as keeping_this,
  up.age              as discarding_this,
  u.consent_updated_at
from public."user" u
join public.user_profile up on up.user_id = u.id
where up.age is not null
  and u.date_of_birth is not null
  and up.age <> u.date_of_birth
order by u.consent_updated_at desc nulls last;


-- ── Step 1.3 · Manual override (only if Step 1.2 showed one you want to keep)─
--
-- Uncomment, set the id and the date, run once per affected user. Editing
-- date_of_birth here does not touch the consent ledger, which is correct: the
-- ledger records what was declared at the time and must not be rewritten.
--
-- update public."user"
--   set date_of_birth = date '1990-01-31'
--   where id = '00000000-0000-0000-0000-000000000000';


-- ── Step 1.4 · The backfill ──────────────────────────────────────────────────
--
-- Copies the profile's birth date onto the user row wherever the user row has
-- none. Idempotent: the `is null` guard means a second run updates 0 rows, and
-- it can never overwrite a gate-verified value with an unverified one.

update public."user" u
set date_of_birth = up.age
from public.user_profile up
where up.user_id = u.id
  and u.date_of_birth is null
  and up.age is not null;


-- ── Step 1.5 · Verify the backfill ───────────────────────────────────────────
--
-- Must return 0. Anything else means Step 1.4 did not take, and Phase 2 would
-- lose exactly that many birth dates.

select count(*) as still_missing_after_backfill
from public.user_profile up
join public."user" u on u.id = up.user_id
where up.age is not null
  and u.date_of_birth is null;


-- ── Step 1.6 · Audit what the backfill let in ────────────────────────────────
--
-- The backfilled values never passed the age gate — they predate it. This
-- surfaces dates that the gate would have rejected: under 15 (§ 7 z. c.
-- 110/2019 Sb.), in the future, or implausibly old.
--
-- Expect this to be empty. A row here is a real finding, not a data-quality
-- nit: an under-15 account cannot validly consent, and the app now refuses to
-- create one. Decide per account whether it is a typo or a genuine minor.

select
  u.id as user_id,
  u.date_of_birth,
  extract(year from age(current_date, u.date_of_birth))::int as years_old,
  case
    when u.date_of_birth > current_date                        then 'future date'
    when u.date_of_birth > current_date - interval '15 years'  then 'under 15'
    when u.date_of_birth < current_date - interval '120 years' then 'implausibly old'
  end as problem
from public."user" u
where u.date_of_birth is not null
  and (
    u.date_of_birth > current_date
    or u.date_of_birth > current_date - interval '15 years'
    or u.date_of_birth < current_date - interval '120 years'
  )
order by u.date_of_birth desc;


-- ── Step 1.7 · Document the column that is on its way out ────────────────────
--
-- Costs nothing, and stops the next person wondering which of the two is real.

comment on column public.user_profile.age is
  'DEPRECATED, holds a birth date despite the name. Superseded by '
  'public."user".date_of_birth, which is what the age gate enforces against. '
  'Backfilled by sql/2026-08-15_birth_date_consolidation.sql. Dropped in '
  'Phase 2 of that file once the application no longer reads it.';


-- ═════════════════════════════════════════════════════════════════════════════
--  PHASE 2 — IRREVERSIBLE. Do not run yet.
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Preconditions, all of them:
--
--   1. UserService.updateUserProfile writes user.date_of_birth, not
--      user_profile.age, and runs meetsMinimumAge() on the incoming value.
--   2. The profile read path returns user.date_of_birth.
--   3. The app no longer references the `age` field (profile store, user store,
--      ProfileEditCard, setup-profile, coach clientCard, queries/user/getUser).
--   4. That code has been deployed and exercised — a profile edit saved and
--      read back, and a coach client card showing the right age.
--   5. Step 2.1 below returns 0.
--
-- There is no rollback. Postgres does not keep a dropped column's data, and
-- Supabase's point-in-time restore is the only way back.


-- ── Step 2.1 · Final guard — must return 0 ───────────────────────────────────

select count(*) as would_lose_birth_date
from public.user_profile up
join public."user" u on u.id = up.user_id
where up.age is not null
  and u.date_of_birth is null;


-- ── Step 2.2 · The drop (uncomment only when 2.1 returned 0) ─────────────────
--
-- alter table public.user_profile drop column if exists age;


-- ── Step 2.3 · Refresh PostgREST's schema cache ──────────────────────────────
--
-- Supabase usually does this automatically after DDL. If the API still reports
-- the column, or reports it missing when it should be there, force it:
--
-- notify pgrst, 'reload schema';
