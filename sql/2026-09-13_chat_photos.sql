-- Disappearing photos in the coach–client chat.
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor,
-- before deploying the API build that sends photos. Every statement is
-- idempotent, so re-running is safe.
--
-- A photo is a `chat_messages` row with kind 'photo' and the storage path in
-- `metadata.photo_path`. `ChatService` deletes the file and then the row once it
-- is 7 days old (see `src/chat/chat-photo.ts`). No new column: the age is
-- `created_at`.

-- ── 1. The bucket ────────────────────────────────────────────────────────────
--
-- Private, with no storage policies: only the service-role API can read it, and
-- the app gets short-lived signed URLs. A public URL could be passed on, and the
-- CDN keeps serving a public object for a while after it is deleted — the
-- opposite of what a disappearing photo promises.

insert into storage.buckets (id, name, public)
values ('chat-photos', 'chat-photos', false)
on conflict (id) do nothing;

-- ── 2. 'photo' as a message kind ─────────────────────────────────────────────
--
-- `chat_messages` predates this folder, so whether `kind` is an enum or text
-- guarded by a check constraint is not on record. Both are handled. On the text
-- path every check constraint that mentions `kind` is replaced by one that also
-- allows 'photo'; the dropped definition is printed as a NOTICE so nothing it
-- also enforced goes unnoticed. If an existing row has a kind outside the new
-- list, adding the constraint fails and the whole block rolls back.

do $$
declare
  kind_type regtype;
  con record;
begin
  select a.atttypid::regtype
    into kind_type
    from pg_attribute a
   where a.attrelid = 'public.chat_messages'::regclass
     and a.attname = 'kind'
     and not a.attisdropped;

  if exists (select 1 from pg_type where oid = kind_type and typtype = 'e') then
    execute format('alter type %s add value if not exists %L', kind_type, 'photo');
    return;
  end if;

  for con in
    select conname, pg_get_constraintdef(oid) as def
      from pg_constraint
     where conrelid = 'public.chat_messages'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    raise notice 'Replacing % : %', con.conname, con.def;
    execute format('alter table public.chat_messages drop constraint %I', con.conname);
  end loop;

  alter table public.chat_messages
    add constraint chat_messages_kind_check
    check (kind in ('text', 'workout_note', 'photo'));
end $$;
