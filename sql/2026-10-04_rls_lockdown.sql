-- Lock the public schema down to what the app actually reads with its own key.
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Every statement is idempotent, so re-running is safe.
--
-- ── Why ──────────────────────────────────────────────────────────────────────
--
-- The anon key ships inside the app bundle, so anyone can call PostgREST with
-- it. The tables that predate `sql/` (user, user_profile, meals, workout_logs,
-- chat_messages, coach_user_relations, user_weight, …) have no RLS on record
-- here, and a table without RLS is readable and writable by that key in full.
-- Views are worse: they run as their owner and ignore the caller's RLS, so a
-- view such as `user_consents_current` hands out every row to anyone allowed
-- to select from it.
--
-- The app talks to the database directly in exactly two ways, both signed in
-- (role `authenticated`):
--   * Realtime on chat_messages, coach_user_relations, coach_access_requests,
--     gym_meetings and user_consent_events — RLS decides which rows arrive.
--   * Storage (the `user` bucket at sign-up) — storage schema, not touched here.
-- Everything else goes through the backend on the service role, which bypasses
-- RLS and is unaffected by every statement below.
--
-- ── What it does ─────────────────────────────────────────────────────────────
--
--   1. RLS on for every table in `public`. A table that had it off is named in
--      a NOTICE. Turning it on with no policy means "service role only".
--   2. Read-own policies for the two Realtime tables that have none on record.
--      Additive: if a policy already exists, the two are OR-ed.
--   3. anon loses every privilege in `public`. Nothing the app does before
--      sign-in touches the database; the public routes (/join, /legal,
--      /app-version) run in the backend.
--   4. authenticated loses SELECT on views (they would bypass step 1).
--   5. The same for objects created later by `postgres` (the SQL editor role).
--
-- Afterwards, run the audit at the bottom and read its output — this file
-- cannot see policies created in the dashboard, and an existing
-- `using (true)` policy would still leave a table open.

-- ── 1. RLS on every table ────────────────────────────────────────────────────

do $$
declare
  t record;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and not c.relrowsecurity
  loop
    raise notice 'enabling RLS on public.% (was off)', t.relname;
    execute format('alter table public.%I enable row level security', t.relname);
  end loop;
end
$$;

-- ── 2. Realtime read policies ────────────────────────────────────────────────
--
-- Same shape as gym_meetings_select_own: either side of the pair. The
-- user_consent_events and exercise_coach_versions policies look up
-- coach_user_relations from the caller's side, which this policy also covers.

drop policy if exists chat_messages_select_own on public.chat_messages;
create policy chat_messages_select_own
  on public.chat_messages
  for select
  to authenticated
  using (user_id = auth.uid() or coach_id = auth.uid());

drop policy if exists coach_user_relations_select_own
  on public.coach_user_relations;
create policy coach_user_relations_select_own
  on public.coach_user_relations
  for select
  to authenticated
  using (user_id = auth.uid() or coach_id = auth.uid());

-- ── 3. anon: nothing in public ───────────────────────────────────────────────

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;

-- ── 4. authenticated: no views ───────────────────────────────────────────────

do $$
declare
  v record;
begin
  for v in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('v', 'm')
  loop
    execute format('revoke all on public.%I from anon, authenticated', v.relname);
  end loop;
end
$$;

-- ── 5. Future objects ────────────────────────────────────────────────────────

alter default privileges for role postgres in schema public
  revoke all on tables from anon;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon;

-- ── Audit (read the output) ──────────────────────────────────────────────────
--
-- Every row here is something to look at:
--   * rls_off           — should be empty after step 1.
--   * policy            — every policy on a public table. Anything whose
--                         `qual` is `true` or does not mention auth.uid() is
--                         open to every signed-in user.
--   * user_bucket       — the `user` storage bucket and its policies: whether
--                         it is public, and whether uploads are limited to the
--                         caller's own `<uid>/` folder.

select 'rls_off' as kind, c.relname as name, null as detail
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
union all
select 'policy', tablename || '.' || policyname,
       cmd || ' to ' || array_to_string(roles, ',') || ' using ' ||
       coalesce(qual, '-') || ' check ' || coalesce(with_check, '-')
  from pg_policies
 where schemaname = 'public'
union all
select 'user_bucket', id, 'public=' || public::text
  from storage.buckets
 where id = 'user'
union all
select 'user_bucket', policyname,
       cmd || ' to ' || array_to_string(roles, ',') || ' using ' ||
       coalesce(qual, '-') || ' check ' || coalesce(with_check, '-')
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
 order by 1, 2;
