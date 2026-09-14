# Monthly draw

`GET /rewards/monthly` and `POST /rewards/box/:month/open` →
`RewardsService`. The draw itself is a cron, `drawClosedMonth`, at 03:20 daily.

Train regularly and the month turns into tickets. When it closes, a job deals
whatever prizes were stocked for that month among everyone who qualified, and
each entrant gets a box to open. The client screens live in the Expo repo
(`components/Rewards/`, `queries/rewards/useMonthlyDraw.ts`).

## One pool for the whole app

Unlike the leaderboard, this is not scored inside a coach's group. A group of
three would otherwise be a far better place to be lucky than a group of thirty,
and the prize bill would grow with every coach who signed up. `scoreMonth` here
takes no roster: it scans the month's `workout_logs` and `meals` outright.

That scan is the price of the simplicity, and it is paid once a month at three
in the morning. If it ever stops being cheap, narrow the meal query to the users
who already cleared the workout bar — everyone else is out of the draw before
their meals matter.

## Tickets

`rewards.tickets.ts`, and it is small on purpose:

- A day with a completed workout is a **ticket**.
- A day with a completed workout **and** a logged meal is **two**.
- A day with only meals is nothing. Logging a meal takes ten seconds, and a bar
  that can be cleared from the sofa is not a bar.
- `MIN_WORKOUT_DAYS` days of training gets you into the draw at all. It is 10,
  it is the one number here worth arguing about, and it is deliberately the only
  place to change it.

Days, not sessions: two workouts on a Tuesday are one ticket, the same way they
are one day of a streak on the leaderboard.

## Stocking the prizes

Nothing is generated. Codes come from the partner and are loaded by hand:

```sql
insert into public.prize_codes (month, label, image_url, code) values
  ('2026-10', 'Extrifit Crea Monohydrate 400 g', 'https://…', 'ABC-123'),
  ('2026-10', 'Extrifit Crea Monohydrate 400 g', 'https://…', 'ABC-124');
```

**How many rows a month has is how many winners it has.** There is no count in
the code to keep in step. A month nobody stocked is left unsettled rather than
settled empty, so codes loaded on the 4th are still dealt on the 5th.

## The draw is repeatable

The seed is the month — `draw:2026-10` — not a random number, and the pool is
every code stocked for the month whether or not it has been awarded. Both
choices exist for the same reason: once the month closes, every input to
`drawWinners` is frozen, so a run that dies half-way deals exactly the same
winners on its next attempt. Nobody loses a prize to a crash and nobody wins one
twice.

`drawWinners` also sorts its entrants by id before dealing, so the result does
not depend on the order PostgREST happened to return rows in. Given
`monthly_boxes` (the entrants and their tickets) and the seed, anyone can deal
the month again and get the same names. That is what a disputed prize is
answered with.

Idempotency is the `monthly_draws` row, written last: a month already in that
table is skipped, so the normal nightly run is one query.

## Opening a box

The result was written when the month closed. `POST /rewards/box/:month/open`
records that it has been seen and returns the contents; it does not decide them.

**An unopened box never carries its prize.** `toSummary` withholds the code
until `opened`, so `GET /rewards/monthly` cannot be used to peek at a box, and a
code cannot be read out of one that was never opened. Opening twice is not an
error either — a phone that drops the response would otherwise have destroyed
the only sight of the prize.

## Details worth knowing

- **Everyone who trains is an entrant, coaches included.** There is no role
  filter. If coaches should be out, that is one `.eq('role', …)` away, but it
  needs deciding rather than assuming.
- **`FIRST_DRAWN_MONTH` is `2026-10`.** Nothing before it is ever settled, for
  the same reason badges start there: a draw nobody knew they were in is not a
  draw.
- **A spent code stays spent.** `awarded_at` lives on `prize_codes`, not on the
  box, so a winner deleting their account does not float their code back into
  the pool.
- **Boxes are the entrant snapshot.** Tickets and workout days are copied into
  the row at draw time; they are not recomputed later, and the month's logs
  could not answer for them anyway once somebody edits a workout.

## Copy

`draw.*` in the Expo repo's `lib/i18n/en.ts` and `cs.ts`. Prize labels are not
translated: they are the partner's product names and arrive from the database.
