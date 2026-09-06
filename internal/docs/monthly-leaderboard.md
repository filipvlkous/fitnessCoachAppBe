# Monthly leaderboard

`GET /leaderboard/monthly?month=YYYY-MM` → `LeaderboardService.getMonthlyLeaderboard`.

Athletes under one coach compete each calendar month on three boards: most
completed workouts, longest workout streak, longest food-logging streak. Both
the athletes and their coach see the same standings. The client screens live in
the Expo repo (`components/Leaderboard/`, `app/user/leaderboard.tsx`,
`app/coach/leaderboard.tsx`).

## The caller never names a group

There is no `coachId` parameter, and that is the whole access model. The service
resolves the group from the token alone: `user.role === 'coach'` scores that
coach's own roster, anyone else scores the roster of the coach they hold an
`approved` row with in `coach_user_relations`. An athlete therefore cannot ask
for a roster they are not part of, because the request has nothing to ask with.
`SupabaseAuthGuard` is load-bearing here rather than decoration — without it the
endpoint has no subject at all.

An athlete with no approved coach gets `coachId: null` and `entries: []`. So does
a coach with an empty roster. Neither is a 404: having no group yet is an
ordinary state, and the client hides the board below two participants anyway.

## What the three numbers mean

- `workouts` — rows in `workout_logs` with `completed = true` dated inside the
  month. Two sessions on one day are two workouts.
- `workoutStreak` — longest run of consecutive days holding at least one such
  workout. Two sessions on one day are one day.
- `foodStreak` — longest run of consecutive days with at least one row in
  `meals`. This is the one number that did not already exist anywhere:
  `monthly-summary` exposes `nutrition.daysLogged`, a total for the month, and a
  total cannot be turned back into consecutive days by the client.

Both streaks are clipped to the month by construction — only in-month days are
ever fed to `longestStreak` — so every board resets on the 1st. A run carried in
from the last week of the previous month is worth only its September half. That
is deliberate: a monthly contest where some entrants start with a 40-day head
start is not a monthly contest.

Day boundaries are UTC, matching every other meal and workout query in this repo
(`monthly-summary`, `retention`, `macros` all filter `00:00:00+00`).

The roster drives the response, not the logs: an athlete who did nothing this
month is still an entry with zeros. Seeing yourself last is rather the point.

### `completed = true` differs from `retention`

`retention` counts a session when it is marked finished **or** has logged sets in
it, on the reasoning that `completed` is a button and somebody who put twelve
sets in without tapping it was in the gym all the same. The leaderboard uses the
strict `completed = true`, matching `monthly-summary`'s `completedWorkouts` and
the field the client documents. The two surfaces can therefore disagree about
whether a given session happened. If the competition should count what retention
counts, the change is the one `.eq('completed', true)` in `scoreMonth`.

## Reads are paged

`fetchAll` pages both queries. PostgREST caps a response at the project's
max-rows — 1000 by default — and a truncated read here would not surface as an
error, it would surface as somebody's streak being shorter than it was. A dozen
clients logging three meals a day pass 1000 rows inside one month, which is an
ordinary gym rather than an edge case. Pages advance by what actually came back
rather than by the requested size, so a project configured below 1000 still
pages correctly; the cost is one empty request at the end.

`retention.collectSignals` reads 28 days of meals for a whole roster the same
way and is **not** paged. It has the same exposure. Untouched here because it is
a separate feature, but it is worth a look.

## Caching

Five minutes, keyed `leaderboard:monthly:<coachId>:<month>` — by the *group*, not
by the caller, so one computation serves the whole gym plus the coach. The
resolve step (two indexed point lookups) runs on every request; only the scoring
is shared. There is no invalidation: a month-long contest does not need
second-level freshness, and the client's own `staleTime` is an hour.

## `avatarUrl` is always null

This schema has no athlete avatar — `avatar_url` belongs to `coach_profile`, and
every existing client-facing surface in the app renders initials. The field is in
the payload because the client already reads it and falls back to initials on
null, so the day athletes get photos only that one line changes.

## Badges: what survives the month

When a month closes, the winner of each board keeps it. `leaderboard_wins`
(`sql/2026-09-05_leaderboard_wins.sql`) is the permanent record — the only
stored part of this feature, because a month in progress changes every time
somebody trains, while a closed month never changes again and *cannot* be
recomputed later: rosters shift, so August's data alone can no longer say who
August's group was.

`GET /leaderboard/badges` returns the caller's own badges for their profile.
Everyone else's counts ride along on the board itself, in `entry.wins`, career-
wide rather than per-group — someone who changed coaches keeps their record.

### Awarding

`awardClosedMonth` is a `@Cron('10 3 * * *')` on `LeaderboardService`. It settles
**last** month, and `pickWinners` (`leaderboard.awards.ts`) chooses:

- **Ties all win.** The board already ranks a tie as a shared first place, and
  splitting two people level on 18 workouts by name would hand a permanent badge
  to whoever's parents picked the earlier letter.
- **A zero never wins.** A group that logged no meals all month has no
  food-streak champion, rather than crowning whoever sorts first on nothing.
- **A group of one is not a contest**, matching the client hiding the board
  below two participants.

Daily rather than monthly, on purpose. A job that fires once at a month boundary
and happens to land in a deploy or an outage loses that month permanently. Daily
also absorbs the timezone case: `@Cron` fires in server-local time while the
month comes from `toISOString()`, so a server far enough east of UTC sees the
previous month on the 1st and settles it on the 2nd instead — a day late rather
than never.

Groups already holding rows for that month are skipped, from one query up front.
That is per-*group* rather than per-month deliberately: a run that dies half way
through leaves the groups it reached alone and finishes the rest tomorrow, which
a single "was this month awarded" flag would have prevented forever.

Re-running is harmless either way — `leaderboard_wins_unique` plus
`ignoreDuplicates` on the upsert.

`FIRST_SCORED_MONTH = '2026-10'` is the floor. September 2026 was already half
over when badges shipped and nobody knew they were competing, so the first
badges land on 1 Nov 2026. No backfill: this was a product decision, not a
technical one, and reversing it means lowering that constant and letting the job
walk the months.

### Two things it does not do

- **The roster is read as it is now, not as it was.** Someone who joins in
  November is scored for October on whatever October data they have. The job
  runs on the 1st, so the drift is a day; a group that churns heavily on the
  turn of the month could see it.
- **Only the previous month is settled.** An outage longer than a month loses
  the month underneath it, and recovering that means running the scoring by
  hand.

### The cache carries a shape version

`leaderboard:monthly:v2:<coachId>:<month>`. Warm keys outlive a deploy, so
without the version a client that just learned to read `entry.wins` finds it
missing for the rest of a five-minute TTL. This was observed, not imagined:
adding `wins` served fieldless entries out of Redis until the key aged out.
Bump `v2` whenever an entry gains or loses a field.

## Verification

`leaderboard.streak.spec.ts` covers the streak arithmetic — what decides two of
the three boards: gaps that must not be bridged, a day logged twice, unordered
rows, month ends, and a daylight-saving change (days are parsed as UTC precisely
so a 23-hour local day is still one day apart).

`leaderboard.awards.spec.ts` covers who wins, which is the part that hands out
something permanent: ties, an athlete taking more than one board, a board the
whole group scored zero on, a month nobody logged anything in, and a group too
small to be a contest.

The Supabase reads were checked against the production database by scoring a real
roster and recomputing the same numbers independently from the raw rows; they
agreed, and an athlete's board matched their coach's exactly. The award job was
dry-run over three real months — read-only, nothing written — which is where the
tie case showed up for real: in August two athletes finished level on a two-day
training streak and both were picked.
