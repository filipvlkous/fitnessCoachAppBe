-- Where a cardio entry came from, so one imported from Apple Health or Health
-- Connect can never be logged twice.
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Every statement is idempotent, so re-running is safe.
--
-- `external_id` is the health store's own id for the workout — HealthKit's
-- sample `uuid`, Health Connect's `metadata.id`. Both are stable across reads,
-- so the partial unique index below is what actually makes importing
-- idempotent: a second attempt at the same run raises 23505 and the service
-- hands back the row that is already there. Entries typed in by hand leave
-- both columns null and are unaffected — the index ignores them.

alter table public.cardio_logs
  add column if not exists source text,
  add column if not exists external_id text;

create unique index if not exists cardio_logs_source_external_id_key
  on public.cardio_logs (source, external_id)
  where external_id is not null;

comment on column public.cardio_logs.source is
  'Where the entry came from: null/''manual'' when typed in, otherwise '
  '''apple_health'' or ''health_connect''.';

comment on column public.cardio_logs.external_id is
  'The health store''s own id for this workout (HealthKit uuid, Health '
  'Connect metadata.id). Null for a manual entry.';
