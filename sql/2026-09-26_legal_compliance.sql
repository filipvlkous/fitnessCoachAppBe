-- Legal compliance: leaderboard consent, content reports, data export.
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor,
-- before deploying the API build that uses it. Every statement is idempotent,
-- so re-running is safe. Run the whole file, never a fragment — section 3 ends
-- with the same REVOKE/GRANT dance as `2026-09-05_account_deletion.sql`.

-- ── 1. 'leaderboard' as a consent key ────────────────────────────────────────
--
-- The monthly board shows a client's workout count and food-logging streak to
-- the other clients of the same coach. Those are health data (GDPR Art. 9)
-- going to people who are neither the operator nor the coach, so it needs its
-- own explicit, opt-in consent. The ledger's check constraint names every key
-- it accepts, so it has to learn the new one.

alter table public.user_consent_events
  drop constraint if exists user_consent_events_key_check;

alter table public.user_consent_events
  add constraint user_consent_events_key_check check (
    (kind = 'consent' and consent_key in (
      'healthData', 'coachSharing', 'analytics', 'marketing', 'leaderboard'
    ))
    or (kind = 'coachScope' and consent_key in (
      'workouts', 'nutrition', 'bodyMetrics'
    ))
  );

-- ── 2. Content reports (DSA Art. 16) ─────────────────────────────────────────
--
-- Anyone can flag a coach profile, a review or a chat message. The operator
-- works the queue in the Supabase dashboard and records the outcome here, so
-- there is a trail of what was reported, decided and why (DSA Art. 17).
--
-- `target_id` has no foreign key on purpose: the report has to outlive the
-- content it is about, otherwise removing the content erases the evidence of
-- why it was removed. The reporter goes with their account.

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public."user" (id) on delete set null,
  target_type text not null
    check (target_type in ('coachProfile', 'review', 'chatMessage')),
  target_id text not null,
  reason text not null
    check (reason in ('illegal', 'harassment', 'sexual', 'dangerous', 'spam', 'other')),
  details text check (char_length(details) <= 2000),
  created_at timestamptz not null default now(),
  status text not null default 'open'
    check (status in ('open', 'actioned', 'rejected')),
  resolution_note text,
  resolved_at timestamptz
);

comment on table public.content_reports is
  'DSA Art. 16 notices. Written by the API only; the operator resolves them in '
  'the dashboard (status, resolution_note, resolved_at) and tells the reporter.';

create index if not exists content_reports_open_idx
  on public.content_reports (created_at)
  where status = 'open';

-- No policies: RLS on with nothing granted means only the service-role API
-- reads or writes. A reporter has no business listing other people's reports.
alter table public.content_reports enable row level security;

-- ── 3. Data export (GDPR Art. 15 and 20) ─────────────────────────────────────
--
-- The mirror image of `delete_user_account`: the same list of tables, read
-- instead of deleted, in one snapshot so the export is internally consistent.
-- `to_jsonb(row)` keeps it independent of column lists — a new column shows up
-- in the export without anyone remembering to add it here. A new *table* does
-- not, which is the same rule as for deletion: add it to both.
--
-- Other people's data stays out. Reviews this account received are exported
-- without the reviewer; chat is the conversation this account took part in.

create or replace function public.export_user_data(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_caller text;
  v_program_ids uuid[];
  v_day_ids uuid[];
  v_log_ids uuid[];
begin
  -- Same guard as delete_user_account, same reason: EXECUTE leaks to anon and
  -- authenticated through Supabase's default privileges, and this function
  -- takes any user id.
  v_caller := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role',
    nullif(current_setting('role', true), 'none')
  );

  if v_caller in ('anon', 'authenticated') then
    raise exception 'export_user_data is backend-only (called as %)', v_caller
      using errcode = '42501';
  end if;

  select coalesce(array_agg(id), '{}') into v_program_ids
    from user_workout_programs where user_id = p_user_id;

  select coalesce(array_agg(id), '{}') into v_day_ids
    from user_program_days where program_id = any (v_program_ids);

  select coalesce(array_agg(id), '{}') into v_log_ids
    from workout_logs
   where user_workout_program_id = any (v_program_ids)
      or program_day_id = any (v_day_ids);

  return jsonb_build_object(
    'exportedAt', now(),
    'account', (select to_jsonb(u) from "user" u where u.id = p_user_id),
    'profile', (select to_jsonb(p) from user_profile p where p.user_id = p_user_id),
    'consentHistory', (select coalesce(jsonb_agg(to_jsonb(e) order by e.decided_at), '[]')
      from user_consent_events e where e.user_id = p_user_id),

    'weight', (select coalesce(jsonb_agg(to_jsonb(t)), '[]')
      from user_weight t where t.user_id = p_user_id),
    'bodyImages', (select coalesce(jsonb_agg(to_jsonb(t)), '[]')
      from user_body_image t where t.user_id = p_user_id),
    'supplements', (select coalesce(jsonb_agg(to_jsonb(t)), '[]')
      from user_supplements t where t.user_id = p_user_id),
    'macroTargets', (select coalesce(jsonb_agg(to_jsonb(t)), '[]')
      from user_assigned_macros t where t.user_id = p_user_id),
    'monthlyReviews', (select coalesce(jsonb_agg(to_jsonb(t)), '[]')
      from monthly_reviews t where t.user_id = p_user_id),

    'programs', (select coalesce(jsonb_agg(to_jsonb(t)), '[]')
      from user_workout_programs t where t.id = any (v_program_ids)),
    'programDays', (select coalesce(jsonb_agg(to_jsonb(t)), '[]')
      from user_program_days t where t.id = any (v_day_ids)),
    'assignedExercises', (select coalesce(jsonb_agg(to_jsonb(t)), '[]')
      from user_assigned_exercises t where t.program_day_id = any (v_day_ids)),
    'workoutLogs', (select coalesce(jsonb_agg(to_jsonb(t)), '[]')
      from workout_logs t where t.id = any (v_log_ids)),
    'exerciseLogs', (select coalesce(jsonb_agg(to_jsonb(t)), '[]')
      from exercise_logs t where t.workout_log_id = any (v_log_ids)),
    'cardioLogs', (select coalesce(jsonb_agg(to_jsonb(t)), '[]')
      from cardio_logs t where t.workout_log_id = any (v_log_ids)),
    'workoutComments', (select coalesce(jsonb_agg(to_jsonb(t)), '[]')
      from workout_comments t
     where t.workout_log_id = any (v_log_ids) or t.user_id = p_user_id),

    'meals', (select coalesce(jsonb_agg(to_jsonb(t)), '[]')
      from meals t where t.user_id = p_user_id),
    'mealIngredients', (select coalesce(jsonb_agg(to_jsonb(t)), '[]')
      from meal_ingredients t
     where t.meal_id in (select id from meals where user_id = p_user_id)),
    'mealEdits', (select coalesce(jsonb_agg(to_jsonb(t)), '[]')
      from meal_edit_log t where t.user_id = p_user_id),

    'chatMessages', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at), '[]')
      from chat_messages t
     where t.user_id = p_user_id or t.coach_id = p_user_id or t.sender_id = p_user_id),
    'coachRelations', (select coalesce(jsonb_agg(to_jsonb(t)), '[]')
      from coach_user_relations t
     where t.user_id = p_user_id or t.coach_id = p_user_id),
    'accessRequests', (select coalesce(jsonb_agg(to_jsonb(t)), '[]')
      from coach_access_requests t
     where t.client_id = p_user_id or t.coach_id = p_user_id),
    'gymMeetings', (select coalesce(jsonb_agg(to_jsonb(t)), '[]')
      from gym_meetings t
     where t.client_id = p_user_id or t.coach_id = p_user_id),
    -- Only the rows about this account as a client: the score is profiling of
    -- them (Art. 15(1)(h)). A coach's view of their clients is the clients' data.
    'retentionScores', (select coalesce(jsonb_agg(to_jsonb(t)), '[]')
      from client_retention t where t.user_id = p_user_id),
    'reviewsWritten', (select coalesce(jsonb_agg(to_jsonb(t)), '[]')
      from coach_reviews t where t.reviewer_id = p_user_id),
    'reviewsReceived', (select coalesce(jsonb_agg(to_jsonb(t) - 'reviewer_id'), '[]')
      from coach_reviews t where t.coach_id = p_user_id),
    'reportsFiled', (select coalesce(jsonb_agg(to_jsonb(t)), '[]')
      from content_reports t where t.reporter_id = p_user_id),

    'coachProfile', (select to_jsonb(t) from coach_profiles t where t.coach_id = p_user_id),
    'coachPlans', (select coalesce(jsonb_agg(to_jsonb(t)), '[]')
      from coach_workout_plans t where t.coach_id = p_user_id),
    'coachPlanExercises', (select coalesce(jsonb_agg(to_jsonb(t)), '[]')
      from coach_workout_plan_exercises t
     where t.plan_id in (select id from coach_workout_plans where coach_id = p_user_id)),
    'coachPresets', (select coalesce(jsonb_agg(to_jsonb(t)), '[]')
      from coach_program_presets t where t.coach_id = p_user_id)
  );
end;
$$;

comment on function public.export_user_data(uuid) is
  'Everything one account owns, as JSON (GDPR Art. 15/20). Mirrors '
  'delete_user_account — a table added to one belongs in the other.';

revoke all on function public.export_user_data(uuid) from public;
revoke all on function public.export_user_data(uuid) from anon, authenticated;
grant execute on function public.export_user_data(uuid) to service_role;

-- ── 4. Deletion learns about content_reports ─────────────────────────────────
--
-- Nothing to do: `reporter_id` is `on delete set null`, so the report stays
-- (it is the operator's record of a DSA notice) and stops naming the reporter.
