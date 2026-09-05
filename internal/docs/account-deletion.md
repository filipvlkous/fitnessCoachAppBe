# Account deletion

`DELETE /userController/user/:id` → `UserService.deleteUser`. Self-service only:
the controller calls `AccessService.assertSelf`, so nobody can delete anybody
else. Three entry points in the app, all hitting the same endpoint —
`app/user/(tabs)/profile.tsx` (trash icon), `app/settings/privacy.tsx`
(withdrawing the Art. 9 consent), `app/(auth)/consent.tsx` (declining at signup).

## Why it used to fail

1. It needs `SUPABASE_SERVICE_ROLE_KEY`: `auth.admin` is a service-role API and
   `getAdminClient()` throws 500 without the key. If deletion starts failing
   again with "SUPABASE_SERVICE_ROLE_KEY is not configured", that variable has
   gone missing from the environment (locally `.env`, in production the
   `ENV` GitHub secret that `rosti_deploy.yml` writes) — or the running process
   is simply older than the key. `dotEnvConfig()` runs once at boot, so adding
   it to `.env` while Nest is up changes nothing until the server restarts, and
   this is the only endpoint that asks for the admin client: everything else
   keeps working, so nothing else reveals that the key is missing.
2. It deleted the auth user, then `public."user"`, and trusted the schema to
   cascade the rest. It does not. Only the tables created by files in `sql/`
   declare `on delete cascade`; the older ones were made in the dashboard, where
   the default is NO ACTION. So the second delete hit a foreign key — after the
   auth user was already gone, leaving an account nobody could log into and data
   nobody could remove.
3. `chat_messages` and `monthly_reviews` have no foreign key to `user` at all,
   so they survived regardless.
4. Uploaded files were never removed, which breaks the promise on the public
   `/delete-account` page and can itself block the auth delete —
   `storage.objects.owner` references `auth.users`.

## How it works now

`sql/2026-09-05_account_deletion.sql` defines `delete_user_account(uuid)`:
every row for the account, one transaction, so a failure deletes nothing rather
than half. `deleteUser` calls it, then clears storage, then deletes the auth
user — data first, auth last, so any failure leaves a working account to retry
with.

Storage touched: `user/<id>/` (body photos, plus the `.keep` object signup
uploads), `coach-images/avatars/<id>.webp`, `coach-images/gallery/<id>/`.

## What survives on purpose

**A coach's clients keep their training.** Programs, days, assigned exercises
and logs belong to the client, not the coach, so `user_workout_programs.coach_id`
and `workout_logs.coach_id` are nulled instead of the rows being deleted. The
app reads `coach_id is null` as a solo program (`sql/2026-08-22_solo_programs.sql`),
so the client keeps the plan and becomes its owner — it renders as "MŮJ PLÁN"
with an Edit button. The coach's private library (day plans, presets) goes;
assigned days are snapshot copies, so only their `source_plan_id` is nulled.

The clients are not told their coach is gone. Nothing notifies them today; they
find out when the coach disappears from the home screen.

**The consent ledger.** `user_consent_events` is append-only by trigger and
outlives the account by design — see the retention note at the bottom of
`sql/2026-08-14_consent_ledger.sql`. What is left is a user id, some booleans
and timestamps: no name, no email, no health data.

## Verifying a change

The function was checked against a throwaway Postgres loaded with the live
schema (dumped from the PostgREST spec at `<SUPABASE_URL>/rest/v1/`) with every
foreign key as NO ACTION — the strictest case. Worth repeating after schema
changes: seed a coach with two clients, delete the client (only their rows go),
delete the coach (both clients keep the full training tree, `coach_id` null).

New table holding user data? Add it to the function. Nothing else picks it up
automatically.

## The function guards itself

`delete_user_account` refuses callers arriving as `anon` or `authenticated`, on
top of the GRANTs at the bottom of the migration. It works out who is calling
from the forwarded JWT claims and, failing that, from the `role` setting
PostgREST sets before running anything — SECURITY DEFINER swaps `current_user`
for the owner but leaves that setting alone, so it still reads true inside the
function. Two signals because the first one alone did not stop an anon call in
practice.

The GRANTs did not hold on their own: after the first apply, the anon key could
still call the RPC and it ran. Supabase's `ALTER DEFAULT PRIVILEGES` hands
EXECUTE on new `public` functions to `anon` and `authenticated`, and re-running
only the `create or replace` block reopens it silently — so a SECURITY DEFINER
function taking an arbitrary user id cannot rely on grants to say no. The anon
key ships inside the app bundle.

Re-run the whole migration file, never a fragment of it.
