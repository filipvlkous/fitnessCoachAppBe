-- Letting a coach close a retention card.
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Every statement is idempotent, so re-running is safe.
--
-- "I know about this one" is a real answer to a warning, and a list that cannot
-- take it becomes a list the coach stops reading. What makes it safe to honour
-- is that it is remembered together with the band it was given for: the daily
-- job clears the dismissal the moment the client's situation gets worse than
-- what was waved away, so closing a card can never hide a client who is
-- actually leaving.

alter table public.client_retention
  add column if not exists dismissed_at timestamptz,
  add column if not exists dismissed_band text;

comment on column public.client_retention.dismissed_at is
  'When the coach closed this card. Cleared by the scoring job once the band '
  'worsens past dismissed_band, or once the client is out of trouble entirely.';

comment on column public.client_retention.dismissed_band is
  'The band the dismissal was given for. A watch dismissed today comes back if '
  'it turns into at_risk tomorrow.';
