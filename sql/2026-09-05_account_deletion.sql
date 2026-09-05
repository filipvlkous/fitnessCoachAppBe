-- Account deletion — remove everything one account owns, in one transaction.
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Every statement is idempotent, so re-running is safe.
--
-- `UserService.deleteUser` used to delete the auth user and then the
-- `public."user"` row and trust the schema to cascade. It does not: roughly
-- fifteen tables point at `user.id` and only the ones created by the files in
-- this directory declare `on delete cascade`. The rest were made in the
-- dashboard, where the default is NO ACTION, so the delete failed on a foreign
-- key — after the auth user was already gone. `chat_messages` and
-- `monthly_reviews` do not reference `user` at all and would have been left
-- behind even if every cascade had been right.
--
-- Doing it as ~25 PostgREST deletes from Nest would not be atomic: any failure
-- halfway leaves a half-deleted account. One function, one transaction.
--
-- What survives on purpose:
--
--   * `user_consent_events`. Append-only by trigger, and the retention note in
--     `2026-08-14_consent_ledger.sql` explains why it outlives the account: it
--     is the evidence that consent was obtained and honoured. What is left is a
--     user_id, some booleans and their timestamps — no name, no email, no
--     health data.
--   * A coach's clients keep the training assigned to them. Their programs,
--     days, assigned exercises and logs are theirs, not the coach's, so
--     `coach_id` is nulled rather than the rows deleted. The app reads
--     `coach_id is null` as a solo program (`2026-08-22_solo_programs.sql`),
--     which leaves the client owning the plan they were training on.
--
-- Storage and the auth user are not touched here — the caller does both, after
-- this returns.

create or replace function public.delete_user_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller text;
  v_program_ids uuid[];
  v_day_ids uuid[];
  v_log_ids uuid[];
begin
  -- ── 0. Who is calling ─────────────────────────────────────────────────────
  --
  -- The GRANTs at the bottom are not enough on their own: Supabase's default
  -- privileges hand EXECUTE to anon and authenticated the moment a function in
  -- `public` is created, and the anon key ships inside the app bundle. A
  -- SECURITY DEFINER function taking an arbitrary user id therefore has to say
  -- no by itself — otherwise anyone holding that key erases any account whose
  -- id they can name.
  --
  -- Two ways to learn who is calling, because neither is guaranteed on its
  -- own: PostgREST puts the key's role in the JWT it forwards, and it also
  -- issues SET LOCAL ROLE before running anything. SECURITY DEFINER swaps
  -- current_user for the owner but leaves the `role` setting alone, so the
  -- second one still reads true in here.
  v_caller := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role',
    nullif(current_setting('role', true), 'none')
  );

  -- Named rather than inverted on purpose: these are the two roles whose keys
  -- leave the server. Anything else — the backend, the SQL editor, a migration
  -- — is already privileged, and a deny-list cannot lock those out by accident.
  if v_caller in ('anon', 'authenticated') then
    raise exception 'delete_user_account is backend-only (called as %)', v_caller
      using errcode = '42501';
  end if;

  -- ── 1. Work this account owns as a coach, but that belongs to a client ─────
  --
  -- Nulling is the only option the schema allows anyway: `coach_id` is a
  -- foreign key, so the row either loses the reference or goes with the coach.

  update user_workout_programs set coach_id = null where coach_id = p_user_id;
  update workout_logs set coach_id = null where coach_id = p_user_id;

  -- A client's day is a copy of the coach's day plan, not a view onto it, so
  -- forgetting where it came from costs nothing and lets the plan go.
  update user_program_days d
     set source_plan_id = null
    from coach_workout_plans p
   where d.source_plan_id = p.id
     and p.coach_id = p_user_id;

  -- ── 2. The coach's own library ────────────────────────────────────────────

  delete from coach_program_preset_days d
   using coach_program_presets p
   where d.preset_id = p.id
     and p.coach_id = p_user_id;

  delete from coach_program_preset_days d
   using coach_workout_plans p
   where d.plan_id = p.id
     and p.coach_id = p_user_id;

  delete from coach_program_presets where coach_id = p_user_id;

  delete from coach_workout_plan_exercises e
   using coach_workout_plans p
   where e.plan_id = p.id
     and p.coach_id = p_user_id;

  delete from coach_workout_plans where coach_id = p_user_id;

  -- ── 3. This account's own training ────────────────────────────────────────
  --
  -- Collected up front because the logs hang off the program two ways —
  -- `user_workout_program_id` and `program_day_id` — and solo sessions predate
  -- one of them.

  select coalesce(array_agg(id), '{}')
    into v_program_ids
    from user_workout_programs
   where user_id = p_user_id;

  select coalesce(array_agg(id), '{}')
    into v_day_ids
    from user_program_days
   where program_id = any (v_program_ids);

  select coalesce(array_agg(id), '{}')
    into v_log_ids
    from workout_logs
   where user_workout_program_id = any (v_program_ids)
      or program_day_id = any (v_day_ids);

  delete from exercise_logs where workout_log_id = any (v_log_ids);
  delete from cardio_logs where workout_log_id = any (v_log_ids);
  delete from workout_comments where workout_log_id = any (v_log_ids);
  -- Comments this account left on somebody else's session — a coach's feedback.
  delete from workout_comments where user_id = p_user_id;
  delete from workout_logs where id = any (v_log_ids);

  delete from exercise_logs
   where assigned_exercise_id in (
     select id from user_assigned_exercises where program_day_id = any (v_day_ids)
   );

  delete from user_assigned_exercises where program_day_id = any (v_day_ids);
  delete from user_program_days where program_id = any (v_program_ids);
  delete from user_workout_programs where id = any (v_program_ids);

  -- ── 4. Food log ───────────────────────────────────────────────────────────

  delete from meal_ingredients
   where meal_id in (select id from meals where user_id = p_user_id);
  delete from meals where user_id = p_user_id;
  delete from meal_edit_log where user_id = p_user_id;

  -- ── 5. Everything that ties this account to somebody else ─────────────────
  --
  -- Both sides of each pair: the account may be the coach or the client.

  delete from chat_messages
   where user_id = p_user_id
      or coach_id = p_user_id
      or sender_id = p_user_id;
  delete from coach_user_relations
   where user_id = p_user_id or coach_id = p_user_id;
  delete from coach_access_requests
   where client_id = p_user_id or coach_id = p_user_id;
  delete from client_retention
   where user_id = p_user_id or coach_id = p_user_id;
  delete from gym_meetings
   where client_id = p_user_id or coach_id = p_user_id;
  delete from coach_reviews
   where reviewer_id = p_user_id or coach_id = p_user_id;
  delete from coach_profiles where coach_id = p_user_id;

  -- ── 6. The account itself ─────────────────────────────────────────────────

  delete from monthly_reviews where user_id = p_user_id;
  delete from user_body_image where user_id = p_user_id;
  delete from user_weight where user_id = p_user_id;
  delete from user_supplements where user_id = p_user_id;
  delete from user_assigned_macros where user_id = p_user_id;
  delete from user_push_tokens where user_id = p_user_id;
  delete from user_profile where user_id = p_user_id;
  delete from "user" where id = p_user_id;
end;
$$;

comment on function public.delete_user_account(uuid) is
  'Erases every row belonging to one account. A coach''s clients keep their '
  'programs, days, assigned exercises and logs with coach_id nulled. '
  'user_consent_events is retained on purpose. Storage objects and the auth '
  'user are the caller''s job.';

-- Only the backend's service-role key may call this. The endpoint in front of
-- it already asserts the caller is deleting themselves.
--
-- Belt and braces with the role check at the top of the body, because these
-- REVOKEs alone have been observed not to hold: Supabase's ALTER DEFAULT
-- PRIVILEGES re-grants EXECUTE on `public` functions to anon and
-- authenticated, and a re-run of just the CREATE (without the rest of this
-- file) reopens the hole silently. Run the whole file, never a fragment.
revoke all on function public.delete_user_account(uuid) from public;
revoke all on function public.delete_user_account(uuid) from anon, authenticated;
grant execute on function public.delete_user_account(uuid) to service_role;
