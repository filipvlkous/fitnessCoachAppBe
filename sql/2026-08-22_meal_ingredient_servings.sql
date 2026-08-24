-- meal_ingredients: emoji + serving breakdown, and macros that keep a decimal
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it in the Supabase SQL editor.
--
--
-- ── RUN THIS BEFORE DEPLOYING THE MATCHING API BUILD ─────────────────────────
--
-- The API build that ships with this file writes these columns on every
-- ingredient row (SupabaseService.saveFoodItems) and selects them back
-- (MacrosService.getMealHistory). Deploying that code against a database
-- without the columns makes every meal save fail with
--
--   42703  column "emoji" of relation "meal_ingredients" does not exist
--
-- which surfaces in the app as "Nepodařilo se uložit jídlo". Every statement is
-- additive and idempotent, so it is safe to run well ahead of the deploy — no
-- code reads or writes these columns until that build goes out.
--
--
-- ── Why ──────────────────────────────────────────────────────────────────────
--
-- The photo scan now describes an amount the way a person would say it: an
-- emoji, a serving name, how much one serving weighs, and how many of them
-- there were — "🍳 2 kusy (100 g)". All of that was being shown on the scan
-- sheet and then thrown away on save, so the food history could only ever
-- render "100 g". These columns let the history show the row the user actually
-- confirmed.
--
-- `servings` is fractional on purpose (half a portion is a normal thing to eat),
-- and `serving_grams` is what one serving weighs, so `weight` stays the source
-- of truth for the macros and the pair is only there to describe it.


-- 1. How the amount reads. All nullable: rows logged before this — and rows
--    from the manual food form, which has no serving concept — simply have no
--    serving breakdown, and the client falls back to showing the weight.
alter table meal_ingredients
  add column if not exists emoji         text,
  add column if not exists servings      numeric(8, 2),
  add column if not exists serving_label text,
  add column if not exists serving_grams numeric(8, 2);


-- 2. Macros were integer columns, so a 5 g pinch of chives at 0.1 g protein
--    stored as 0 and the meal's ingredient breakdown did not add up to its
--    total. numeric(8,1) keeps the one decimal the analyzer produces.
--
--    Widening integer -> numeric preserves every existing value exactly; it is
--    only the future precision that changes. Postgres rewrites the table for
--    this, so expect it to take a moment on a large meal_ingredients.
alter table meal_ingredients
  alter column protein type numeric(8, 1),
  alter column fat     type numeric(8, 1),
  alter column carbs   type numeric(8, 1);
