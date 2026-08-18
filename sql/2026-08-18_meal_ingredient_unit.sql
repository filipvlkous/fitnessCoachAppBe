-- meal_ingredients.unit — record whether an amount was grams or millilitres
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it in the Supabase SQL editor.
--
--
-- ── RUN THIS BEFORE DEPLOYING THE MATCHING API BUILD ─────────────────────────
--
-- The API build that ships with this file inserts a `unit` value on every
-- ingredient row (SupabaseService.saveFoodItems) and selects it back
-- (MacrosService.getMealHistory). Deploying that code against a database
-- without this column makes every meal save fail with
--
--   42703  column "unit" of relation "meal_ingredients" does not exist
--
-- which surfaces in the app as "Nepodařilo se uložit jídlo". Nothing is lost,
-- but food logging is down until the column exists. This file is additive and
-- safe to run on its own well ahead of the deploy — no code reads or writes the
-- column until that build goes out.
--
--
-- ── Why a unit column at all ─────────────────────────────────────────────────
--
-- `weight` has always been a bare number of grams, which is wrong for anything
-- poured: a 330 ml beer, 200 ml of milk, a spoon of oil. The manual food form
-- now lets the user log those in ml, and the number it sends is the same number
-- it would send for grams — nutrition databases publish per 100 g for solids and
-- per 100 ml for drinks in the same `_100g` fields, so both share one scale and
-- the macro arithmetic is untouched. Only the label was missing, and without it
-- the food history renders "330 g of beer".
--
-- So this stores the label, not a conversion. No existing value changes meaning:
-- everything logged so far was grams, which is exactly what the default gives.
--
-- Deliberately NOT changed here: meals.total_weight. It sums every ingredient
-- regardless of unit, so for a dish mixing 200 g of rice with 300 ml of milk it
-- reads 500. That total has no meaningful unit and never had one; clients that
-- care show the per-ingredient amounts instead of a single figure.


-- ── Step 1 · Add the column ──────────────────────────────────────────────────
--
-- `default 'g'` backfills every existing row in place, because every amount
-- recorded before today was grams. `not null` is safe for the same reason, and
-- keeps the API from ever writing an ambiguous row later.

alter table public.meal_ingredients
  add column if not exists unit text not null default 'g';


-- ── Step 2 · Constrain it to the two units the app knows ─────────────────────
--
-- Without this the column accepts 'kg', 'oz', '' or a typo, and the app would
-- render whatever landed there straight into the history. The API already maps
-- anything unexpected to 'g', so this only ever fires on a hand-written insert.
--
-- Guarded so re-running the file does not fail on an existing constraint.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'meal_ingredients_unit_check'
  ) then
    alter table public.meal_ingredients
      add constraint meal_ingredients_unit_check check (unit in ('g', 'ml'));
  end if;
end $$;


-- ── Step 3 · Document it ─────────────────────────────────────────────────────

comment on column public.meal_ingredients.unit is
  'Unit the amount in "weight" was entered as: g for solids, ml for liquids. '
  'A display label only — both units share one per-100 scale, so "weight" '
  'means the same number either way. Rows predating '
  'sql/2026-08-18_meal_ingredient_unit.sql are all grams.';


-- ── Step 4 · Verify ──────────────────────────────────────────────────────────
--
-- Expect one row per unit in use: 'g' with the full pre-existing count, and
-- 'ml' appearing only once someone logs a drink through the updated app.

select unit, count(*) as rows
from public.meal_ingredients
group by unit
order by unit;


-- ── Step 5 · Refresh PostgREST's schema cache ────────────────────────────────
--
-- Supabase normally does this itself after DDL. If getMealHistory still errors
-- with "column meal_ingredients.unit does not exist" once the column is clearly
-- there, the cache is stale — force it:
--
-- notify pgrst, 'reload schema';
