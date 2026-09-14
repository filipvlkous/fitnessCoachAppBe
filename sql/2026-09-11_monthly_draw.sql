-- Monthly draw: a prize drawn among everyone who trained regularly that month.
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Every statement is idempotent, so re-running is safe.
--
-- Three tables, and the split between them is the point:
--
--   prize_codes    what there is to win, loaded by hand before the month ends
--   monthly_boxes  who entered, with how many tickets, and what they got
--   monthly_draws  that the draw for a month happened, and how to reproduce it
--
-- Tickets themselves are not stored. They are counted from workout_logs and
-- meals the same way the leaderboard counts streaks, and a month in progress
-- changes every time somebody trains. Only the settled result is written down.

create table if not exists public.prize_codes (
  id uuid primary key default gen_random_uuid(),

  -- 'YYYY-MM'. The month this code is stocked for. A code is not carried over
  -- to the next month by accident: stocking is a deliberate act each time.
  month text not null,

  -- What the winner is told they won, and the picture of it. Free text rather
  -- than a product id: the partner's catalogue is not in this database, and a
  -- prize is sometimes a thing that is not in any catalogue.
  label text not null,
  image_url text,

  -- The redeemable code itself. Never leaves the server until its box is
  -- opened, and never appears in the leaderboard payload.
  code text not null,

  -- Set the moment the draw hands this code out. This, not the box, is what
  -- makes a code spent: a winner deleting their account takes the box with
  -- them, and a spent code must not quietly return to the pool.
  awarded_at timestamptz,

  created_at timestamptz not null default now(),

  constraint prize_codes_month_check
    check (month ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

-- The same code twice in the pool would be two winners holding one prize.
create unique index if not exists prize_codes_code_unique
  on public.prize_codes (code);

-- What the draw asks for: this month's unspent codes.
create index if not exists prize_codes_pool_idx
  on public.prize_codes (month)
  where awarded_at is null;

comment on table public.prize_codes is
  'The prize pool, stocked by hand. How many rows a month has is how many '
  'winners that month has.';


create table if not exists public.monthly_boxes (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references public."user"(id) on delete cascade,

  -- 'YYYY-MM'. The month that was played, not the month it was drawn in.
  month text not null,

  -- The entry as it stood at the draw. Kept because a draw nobody can check is
  -- a draw nobody should trust: with these, the seed and the code count, the
  -- whole month can be dealt again and must come out the same.
  tickets integer not null,
  workout_days integer not null,

  -- Null is a real result, not a missing one: most boxes are empty.
  prize_code_id uuid
    references public.prize_codes(id) on delete set null,

  -- Null until the athlete opens it. The result is decided before this is set;
  -- opening reveals, it does not roll.
  opened_at timestamptz,

  created_at timestamptz not null default now(),

  constraint monthly_boxes_month_check
    check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),

  constraint monthly_boxes_tickets_positive
    check (tickets > 0 and workout_days > 0)
);

-- One box per athlete per month. Also the draw's idempotency: a second run for
-- a month that already has boxes writes nothing.
create unique index if not exists monthly_boxes_unique
  on public.monthly_boxes (user_id, month);

-- One code cannot land in two boxes.
create unique index if not exists monthly_boxes_prize_unique
  on public.monthly_boxes (prize_code_id)
  where prize_code_id is not null;

-- The screen's read: my boxes, newest month first.
create index if not exists monthly_boxes_user_idx
  on public.monthly_boxes (user_id, month desc);

comment on table public.monthly_boxes is
  'One row per qualified athlete per drawn month: the entry, and what it won. '
  'Written only by the draw job.';


create table if not exists public.monthly_draws (
  -- 'YYYY-MM'. One draw per month, ever.
  month text primary key,

  -- The seed the winners were dealt from. Stored so the draw can be repeated
  -- and checked against monthly_boxes rather than taken on faith.
  seed text not null,

  entrants integer not null,
  prizes integer not null,

  drawn_at timestamptz not null default now(),

  constraint monthly_draws_month_check
    check (month ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

comment on table public.monthly_draws is
  'That a month was drawn, and what it would take to deal it again.';


-- RLS: an athlete sees their own boxes, and nothing else here.
--
-- The app reads through the backend's service-role key, as the leaderboard
-- does. These policies are for direct client reads, so they stay narrow. The
-- other two tables get no policy at all: the pool would tell everyone what is
-- left to win, and a code is worth money to whoever reads it first.

alter table public.monthly_boxes enable row level security;
alter table public.prize_codes enable row level security;
alter table public.monthly_draws enable row level security;

drop policy if exists monthly_boxes_select_own on public.monthly_boxes;
create policy monthly_boxes_select_own
  on public.monthly_boxes
  for select
  to authenticated
  using (user_id = auth.uid());


-- Account deletion needs no change. `delete_user_account`
-- (sql/2026-09-05_account_deletion.sql) ends with `delete from "user"`, and the
-- cascade above takes the boxes with it. The codes those boxes held keep their
-- `awarded_at`, so they stay spent and cannot be drawn again.
