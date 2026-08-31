-- Realtime for gym meetings.
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Every statement is idempotent, so re-running is safe.
--
-- Every answer to a meeting is made on the other party's phone: the coach
-- confirms, declines or puts a different time back, the client confirms that
-- counter-offer, either side cancels. The waiting side has nothing local to
-- react to, so without this its card only moves on a screen focus or a tapped
-- notification. Publishing the table lets both apps subscribe and re-read.
--
-- No `replica identity full` here, unlike coach_user_relations: a meeting is
-- never deleted, it is cancelled — a status update, which carries the whole new
-- row. Deletes only happen when a user is deleted and the FK cascades, and by
-- then the meeting is the smaller of that person's problems.
--
-- RLS: gym_meetings_select_own (in 2026-08-30_gym_meetings.sql) already limits
-- reads to the two parties, and Realtime checks inserts and updates against
-- that same policy on the new row. Nothing more is needed.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'gym_meetings'
     )
  then
    alter publication supabase_realtime add table public.gym_meetings;
  end if;
end $$;
