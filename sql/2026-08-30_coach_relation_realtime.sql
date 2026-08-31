-- Realtime for the coach–client relation.
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Every statement is idempotent, so re-running is safe.
--
-- The athlete's app draws everything that says they have a coach — the plan,
-- the chat, the coach card — from their row in coach_user_relations, and
-- subscribes to that row so a coach's answer lands without a restart.
-- Approvals arrived; removals did not. Under the default replica identity
-- Postgres writes only the primary key to the WAL for a delete, so the deleted
-- row carried no user_id, the subscription's `user_id=eq.…` filter had nothing
-- to match, and the event was dropped before it reached the athlete — who went
-- on looking at a plan and a chat they no longer had until the app next came
-- back to the foreground.
--
-- REPLICA IDENTITY FULL puts the whole deleted row in the WAL, which is what
-- both that filter and Realtime's RLS check on deletes need. The cost is an
-- old-row image written on every update and delete of this table; it holds one
-- row per coach–client pair and is written on join, approve and removal only,
-- so this is noise next to the meal and workout tables.

alter table public.coach_user_relations replica identity full;

-- Realtime only publishes tables in this publication. Normally already done
-- from the dashboard toggle — the athlete does receive approvals today — but
-- spelled out so this file stands on its own on a fresh project.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'coach_user_relations'
     )
  then
    alter publication supabase_realtime add table public.coach_user_relations;
  end if;
end $$;

-- Note on RLS: if row level security is enabled on this table, Realtime checks
-- the subscriber against the *deleted* row, so the athlete needs a select
-- policy matching `user_id = auth.uid()` (and the coach one matching
-- `coach_id = auth.uid()`) for the delete to be delivered. Nothing is created
-- here — the policies that already let approvals through cover deletes too
-- once the row above is complete.
