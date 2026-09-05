-- Client retention: how likely a client is to drop off, and why.
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Every statement is idempotent, so re-running is safe.
--
-- Nothing new is tracked. Every signal behind the score already exists —
-- workout_logs, meals, chat_messages, gym_meetings, user_weight — and this
-- table is only the daily job's answer, kept so the coach's list is a plain
-- read instead of a fan-out of aggregations across every client on every open.
--
-- The score itself is computed in the service, not here, and not by the model:
-- it is arithmetic over dates, and arithmetic that decides which clients a
-- coach chases has to be reproducible. The model writes `note` — the reading of
-- those numbers and a message the coach can send — and never the number.

create table if not exists public.client_retention (
  -- One row per coach-client pair rather than per client: two coaches sharing
  -- a client each see their own relationship, and a removed relation takes its
  -- row with it.
  coach_id uuid not null
    references public."user"(id) on delete cascade,
  user_id uuid not null
    references public."user"(id) on delete cascade,

  computed_at timestamptz not null default now(),

  -- 0-100, higher = more likely to leave. Null while the client is too new to
  -- judge (band 'new'), which is not the same as a zero.
  score smallint,

  band text not null,

  -- The scored reasons, each with its points and the numbers behind it. This is
  -- what the coach's UI shows when there is no AI note, what the note is
  -- generated from, and what makes a score arguable rather than an oracle.
  factors jsonb not null default '[]'::jsonb,

  -- The raw signal vector the score was computed from. Kept for the same
  -- reason: a score nobody can take apart is a score nobody trusts.
  signals jsonb not null default '{}'::jsonb,

  -- { headline, why, suggestedAction, draftMessage }. Null for calm clients —
  -- they are not generated for, and for anyone the model failed on.
  note jsonb,
  model text,

  -- Hash of the rounded signals the note was written from. The daily job
  -- regenerates only when this changes, so a client whose picture is unchanged
  -- costs nothing after the first run.
  inputs_hash text,

  -- The band the coach was last pushed about. A client who stays at risk is
  -- not news every morning; only the crossing is.
  notified_band text,
  notified_at timestamptz,

  primary key (coach_id, user_id),

  constraint client_retention_band_check
    check (band in ('new', 'ok', 'watch', 'at_risk')),

  constraint client_retention_score_range
    check (score is null or score between 0 and 100),

  -- A coach is not their own client.
  constraint client_retention_distinct_parties
    check (coach_id <> user_id)
);

comment on table public.client_retention is
  'Per coach-client drop-off risk: a deterministic score with its factors, plus '
  'an AI note explaining it and drafting the follow-up message. Rewritten by '
  'the daily retention job.';

comment on column public.client_retention.score is
  '0-100, higher = more likely to leave. Null while band = new.';


-- The coach dashboard's only query: my clients, worst first.
create index if not exists client_retention_coach_idx
  on public.client_retention (coach_id, score desc nulls last);


-- RLS: the coach, and only the coach.
--
-- Writes go through the backend's service-role key, which is where the scoring
-- runs. The policy below covers direct client reads — and deliberately does not
-- include `user_id = auth.uid()`: this table says how likely someone is to quit
-- and drafts the message to talk them out of it, which is the coach's working
-- note about a client, not something the client is meant to read about
-- themselves.

alter table public.client_retention enable row level security;

drop policy if exists client_retention_select_coach on public.client_retention;
create policy client_retention_select_coach
  on public.client_retention
  for select
  to authenticated
  using (coach_id = auth.uid());
