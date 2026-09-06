-- Monthly competition badges: who won a board, kept for good.
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Every statement is idempotent, so re-running is safe.
--
-- The boards themselves are computed on the fly from workout_logs and meals and
-- are not stored — a month in progress changes every time somebody trains. This
-- table is only the *result* of a month that has closed, which never changes
-- again, and which cannot be recomputed later without keeping the roster as it
-- was: clients join, leave and change coaches, so last August's standings are
-- not something August's data can still answer on its own.

create table if not exists public.leaderboard_wins (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references public."user"(id) on delete cascade,

  -- Where it was won. `set null`, not `cascade`, on purpose: a badge is the
  -- athlete's, and a coach closing their account must not quietly erase what
  -- their clients earned under them.
  coach_id uuid
    references public."user"(id) on delete set null,

  -- 'YYYY-MM'. The month that closed, not the month it was awarded in.
  month text not null,

  category text not null,

  -- What the winning number was: 21 workouts, a 12-day streak. Kept so the
  -- profile can say what the badge was for, and so a disputed award can be
  -- checked against the logs rather than taken on faith.
  value integer not null,

  created_at timestamptz not null default now(),

  constraint leaderboard_wins_category_check
    check (category in ('workouts', 'workoutStreak', 'foodStreak')),

  constraint leaderboard_wins_month_check
    check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),

  -- Nobody wins a board they scored nothing on.
  constraint leaderboard_wins_value_positive
    check (value > 0),

  -- A coach does not compete against their own roster.
  constraint leaderboard_wins_distinct_parties
    check (coach_id is null or coach_id <> user_id)
);

comment on table public.leaderboard_wins is
  'One row per athlete per board per closed month: the permanent record of a '
  'monthly competition win. Written only by the award job, which is idempotent.';

comment on column public.leaderboard_wins.coach_id is
  'The group it was won in. Null once that coach deletes their account; the '
  'badge itself survives.';


-- The award job's idempotency, and the reason a re-run is harmless. A tie is
-- not a conflict — everyone level on first place gets their own row — so the
-- key carries user_id. The job is the only writer.
create unique index if not exists leaderboard_wins_unique
  on public.leaderboard_wins (coach_id, month, category, user_id);

-- Both reads: the badges on one profile, and the win counts for a whole roster
-- in one go.
create index if not exists leaderboard_wins_user_idx
  on public.leaderboard_wins (user_id, month desc);


-- RLS: the athlete and their coach.
--
-- The app never reads this table directly — both surfaces go through the
-- backend's service-role key, which is what lets the scoreboard show everyone's
-- badges to everyone in the group. The policy below is for direct client reads,
-- so it stays narrow: your own badges, and your clients'. Writes have no policy
-- at all, because nothing but the award job may write here.

alter table public.leaderboard_wins enable row level security;

drop policy if exists leaderboard_wins_select_own on public.leaderboard_wins;
create policy leaderboard_wins_select_own
  on public.leaderboard_wins
  for select
  to authenticated
  using (user_id = auth.uid() or coach_id = auth.uid());


-- Account deletion needs no change for this table. `delete_user_account`
-- (sql/2026-09-05_account_deletion.sql) ends with `delete from "user"`, and the
-- two foreign keys above do the rest: the athlete's badges go with them, and a
-- deleted coach only nulls the attribution. Nothing to add to that function —
-- unlike the older dashboard-made tables it has to name one by one, this one
-- declares its own behaviour.
