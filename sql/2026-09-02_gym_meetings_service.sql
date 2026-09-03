-- What the client is asking for, not just when.
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Every statement is idempotent, so re-running is safe.
--
-- The coach's price list (`coach_profiles.price_list`) already names what they
-- offer and how long each one takes. Booking one of those instead of a bare
-- length is what makes a request answerable at a glance: "60 minutes on
-- Tuesday" tells the coach much less than "Personal training, Tuesday".
--
-- The name is copied onto the row rather than referenced by id, for the same
-- reason `location` is free text: the price list is edited in place, and a
-- session that has already happened should keep saying what it was, even after
-- the coach renames or removes the service.

alter table public.gym_meetings
  add column if not exists service text;

comment on column public.gym_meetings.service is
  'Name of the coach service this session was booked for, copied from the '
  'price list at request time. Null for a request made without one.';
