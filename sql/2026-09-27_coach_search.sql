-- Coach search for the client's "find a coach" list.
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Every statement is idempotent, so re-running is safe.
--
-- Replaces a PostgREST query built in the API, which had three problems: the
-- name box never looked at the coach's name, the search text was spliced into
-- an `or=(...)` filter unescaped, and "location" was an accent-sensitive
-- ILIKE on the address, so "Plzen" never found "Plzeň". It also could not use
-- the pin coaches drop on the map (coach_profiles.lat/lng) at all.
--
-- Matching uses unaccent + strpos rather than LIKE, so `%` and `_` in the
-- search text are plain characters. Distance is the haversine formula in plain
-- SQL; a few hundred coaches do not need PostGIS or an index.

create extension if not exists unaccent with schema extensions;

create or replace function public.search_coaches(
  p_name text default null,
  p_location text default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_min_rating numeric default null,
  -- The searcher's position. Without it there is no distance, and neither
  -- p_radius_km nor p_sort = 'distance' does anything.
  p_lat double precision default null,
  p_lng double precision default null,
  p_radius_km double precision default null,
  -- 'rating' (default), 'price' (cheapest first) or 'distance' (nearest first).
  p_sort text default 'rating',
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  with base as (
    select
      v.coach_id,
      v.specialty,
      v.hourly_rate,
      v.first_name,
      v.last_name,
      v.gym,
      v.avatar_url,
      v.avg_rating,
      v.review_count,
      p.lat,
      p.lng,
      case
        when p_lat is not null and p_lng is not null
         and p.lat is not null and p.lng is not null
        then 6371 * 2 * asin(sqrt(
          power(sin(radians(p.lat - p_lat) / 2), 2)
          + cos(radians(p_lat)) * cos(radians(p.lat))
            * power(sin(radians(p.lng - p_lng) / 2), 2)
        ))
      end as distance_km
    from coach_profiles_with_stats v
    join coach_profiles p on p.coach_id = v.coach_id
    where v.is_visible
      and (p_name is null or strpos(
        unaccent(lower(concat_ws(' ',
          v.first_name, v.last_name, v.specialty, v.gym, p.bio))),
        unaccent(lower(p_name))) > 0)
      and (p_location is null or strpos(
        unaccent(lower(coalesce(v.gym, ''))),
        unaccent(lower(p_location))) > 0)
      and (p_min_price is null or v.hourly_rate >= p_min_price)
      and (p_max_price is null or v.hourly_rate <= p_max_price)
      and (p_min_rating is null or v.avg_rating >= p_min_rating)
  ),
  filtered as (
    select
      b.*,
      row_number() over (
        order by
          case when p_sort = 'distance' then b.distance_km end asc nulls last,
          case when p_sort = 'price' then b.hourly_rate end asc nulls last,
          b.avg_rating desc nulls last,
          b.hourly_rate asc,
          b.coach_id
      ) as rn
    from base b
    -- A coach without a pin has no distance, so a radius leaves them out.
    where p_radius_km is null or b.distance_km <= p_radius_km
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'data', coalesce(
      (select jsonb_agg(to_jsonb(f) - 'rn' order by f.rn)
         from filtered f
        where f.rn > p_offset and f.rn <= p_offset + p_limit),
      '[]'::jsonb
    )
  );
$$;

comment on function public.search_coaches is
  'Visible coaches matching the client''s filters, one page of them plus the '
  'total. Accent- and case-insensitive text matching; optional distance from '
  'the searcher in km.';

revoke all on function public.search_coaches from public;
revoke all on function public.search_coaches from anon, authenticated;
grant execute on function public.search_coaches to service_role;
