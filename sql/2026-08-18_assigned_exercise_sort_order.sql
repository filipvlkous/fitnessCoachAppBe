-- user_assigned_exercises.sort_order — make the coach's exercise order stick
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it in the Supabase SQL editor.
--
--
-- ── Safe to run at any time ──────────────────────────────────────────────────
--
-- The `sort_order` column already exists; nothing here adds or drops one, and
-- the API works with or without this file. The real fix ships in the API: every
-- read path now sorts assigned exercises by `sort_order` instead of trusting
-- the order PostgREST happens to return, which changes as soon as any row in
-- the day is updated.
--
-- The production data was checked before writing this: no day has its exercises
-- tied on a single `sort_order`, so there is no order to reconstruct. What is
-- left is a NULL guard and an index.


-- 1. A NULL sort_order sorts as 0 in the API, so a day with several of them
--    lands right back in the tie the API fix is meant to avoid. Give any such
--    rows a real position, keeping the creation sequence they're displayed in
--    today. Matches nothing if the column has always been populated.
with renumbered as (
  select
    uae.id,
    row_number() over (
      partition by uae.program_day_id
      order by uae.sort_order asc nulls last, uae.created_at asc, uae.id asc
    ) - 1 as new_sort_order
  from user_assigned_exercises uae
  where uae.program_day_id in (
    select program_day_id
    from user_assigned_exercises
    where sort_order is null
  )
)
update user_assigned_exercises uae
set sort_order = renumbered.new_sort_order
from renumbered
where renumbered.id = uae.id
  and uae.sort_order is distinct from renumbered.new_sort_order;


-- 2. A day's exercises are always read as an ordered list, so index for it.
create index if not exists user_assigned_exercises_day_order_idx
  on user_assigned_exercises (program_day_id, sort_order);
