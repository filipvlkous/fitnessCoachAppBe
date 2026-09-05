-- Realtime for data sharing between a client and their coach.
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Every statement is idempotent, so re-running is safe.
--
-- Both sides of this feature wait on an answer given on somebody else's phone:
--
--   * The coach hits a locked section and asks. The client's app only learns
--     about the ask from a push, which does nothing for someone already holding
--     the app open — the card appeared on the next stale refetch, up to a
--     minute later, or not at all.
--   * The client grants (or withdraws) a scope. The coach's screen reads the
--     permission once on mount, so a section stayed locked until they left the
--     client and came back — and, worse, a withdrawn one stayed open.
--
-- Publishing the two tables lets each app subscribe and re-read. The rows are
-- only a "something moved" ping in both directions: what the coach may
-- actually see is decided by UserService.getCoachDataAccess, never by the
-- payload, so a subscriber learning of a change learns nothing about its
-- content from the socket.
--
-- No `replica identity full` on either table, unlike coach_user_relations.
-- The ledger is append-only (the trigger in 2026-08-14_consent_ledger.sql
-- refuses updates and deletes), and a request is resolved by a status update
-- that carries the whole new row. Deletes only happen when a user is deleted
-- and the FK cascades, and by then there is nothing left to render.


-- ── 1. The coach's ask ───────────────────────────────────────────────────────
--
-- RLS is already in place: coach_access_requests_select_own (in
-- 2026-08-15_coach_access_requests.sql) limits reads to the two parties, and
-- Realtime checks inserts and updates against that same policy on the new row.
-- The client subscribes with `client_id=eq.<their id>` and matches it.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'coach_access_requests'
     )
  then
    alter publication supabase_realtime add table public.coach_access_requests;
  end if;
end $$;


-- ── 2. The client's answer ───────────────────────────────────────────────────
--
-- Every sharing decision lands here as a new row, whether it came from
-- answering a request or from a switch in Settings, which is why the coach
-- subscribes to the ledger rather than to the request table: a grant made in
-- Settings has no request to move.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'user_consent_events'
     )
  then
    alter publication supabase_realtime add table public.user_consent_events;
  end if;
end $$;


-- ── 3. Letting the coach hear it ─────────────────────────────────────────────
--
-- user_consent_events_select_own is read-your-own, so without a second policy
-- Realtime drops every one of these rows before it reaches the coach and the
-- subscription above is inert for them.
--
-- What this opens up, deliberately narrowly:
--   * only the two kinds of row that describe sharing with a coach. The
--     analytics and marketing decisions, and the Art. 9 health consent, stay
--     private — none of them are the coach's business.
--   * only for a client this coach actually holds an approved relation to, and
--     only for as long as they hold it. The subquery reads
--     coach_user_relations under the coach's own RLS, so if that read is
--     refused the exists is false and nothing is delivered: it fails closed.
--   * select only. Writes still go through the backend's service-role key,
--     which is the only place the age gate runs, and the append-only trigger
--     refuses edits from every role including that one.
--
-- The coach can therefore read *when* this client turned sharing on or off,
-- not merely the current state. That is a real widening over the endpoint,
-- which only answers "now". It is accepted because the alternative — a
-- coach-readable mirror of the current state, kept in step by the consent
-- service — is a second copy of the fact that decides access, and a second
-- copy that can drift is worse than a visible history.

drop policy if exists user_consent_events_select_coach on public.user_consent_events;
create policy user_consent_events_select_coach
  on public.user_consent_events
  for select
  to authenticated
  using (
    (
      kind = 'coachScope'
      or (kind = 'consent' and consent_key = 'coachSharing')
    )
    and exists (
      select 1
      from public.coach_user_relations r
      where r.user_id = user_consent_events.user_id
        and r.coach_id = auth.uid()
        and r.status = 'approved'
    )
  );
