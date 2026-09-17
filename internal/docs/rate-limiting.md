# Rate limiting

How much one caller may ask of the backend. Two limits, both enforced by
`@nestjs/throttler` registered as a global guard.

| Limit | Scope | Budget | Header on 429 |
| ----- | ----- | ------ | ------------- |
| `default` | The whole API, per caller | 120 req / 60 s | `Retry-After` |
| `heavy` | One route, per caller | route's own | `Retry-After-heavy` |

Today the only route that opts into `heavy` is
`POST /image-analysis/food/analyze`, at **10 req / 60 s**. It is the one
endpoint that pays a third party per request and the one that accepts a 10 MB
body to do it.

Everything lives in `src/throttler.config.ts` and `src/throttler-tracker.ts`.
The numbers are hardcoded, like the body limit in `main.ts` — there is no env
var to turn this off.

## The API-wide budget is not per endpoint

The package's default key generator buckets per route handler. A single
`limit: 120` would therefore mean 120/minute *on each endpoint*, so a client
that knows twenty of them would get 2400/minute and the number would mean
nothing.

The `default` throttler supplies its own `generateKey` that leaves the handler
out, which is what makes 120 the whole-API figure it reads as. The `heavy`
throttler keeps the per-handler key — that is the point of it.

That is also why `heavy` exists as a second throttler instead of routes simply
tightening `default` with `@Throttle`. Overriding `default` on one route would
change the threshold on the *shared* bucket, so a caller who had done ordinary
work that minute would be refused a photo scan they had not made yet.

## Callers are told apart by session, not by address

`throttlerTracker` keys on a hash of the bearer token, falling back to the
client address only when there is no token (`/`, `/join`, `/app-version`).

Keying on the address would have been wrong twice over:

- **Mobile clients share addresses.** Carrier-grade NAT puts a lot of people
  behind one address, and they would have shared one budget.
- **`req.ip` is not the client.** nginx on Roští proxies from 127.0.0.1 and
  sets `X-Real-IP` but *not* `X-Forwarded-For`, so Express reports every
  request as local — `trust proxy` would not have helped. The tracker reads
  `X-Real-IP` directly. That is safe because nginx overwrites it with
  `$remote_addr`, discarding whatever the client sent.

The token is hashed rather than used raw: nothing that is merely a storage key
should hold a usable access token.

**Known gap.** A caller sending a *different* random bearer token each time
gets a fresh budget every request and slips past the per-session key. Each of
those requests still dies on `SupabaseAuthGuard` with a 401, so it buys an
attacker only 401s — but it is not a limit on them. If that ever matters, the
answer is `limit_req_zone` in the nginx config (the deploy workflow writes it),
not more logic here: a single container does not survive a real flood either
way.

## Storage is in memory, and that is load-bearing

The counters live in the process. That is correct **because the backend runs as
a single supervisord process** (`.github/workflows/rosti_deploy.yml`, the
`[program:app]` block).

If it is ever run as more than one instance, this has to move to Redis — every
instance would otherwise allow the full limit on its own, and the real limit
becomes the number of instances times the number in the config. The app already
has Upstash Redis configured for caching, so the storage adapter is the only
missing piece.

Counters are also lost on restart. A deploy resets everyone's budget; at these
limits that does not matter.

## The guard runs before authentication

Global guards run before the controllers' `@UseGuards(SupabaseAuthGuard)`.
Two consequences, both wanted:

- A flood is turned away without spending a Supabase token validation on it.
- `request.user` does not exist yet, which is why the tracker keys on the raw
  token rather than on a user id.

## Changing the numbers

`src/throttler.config.ts` for the API-wide budget, the `@Throttle` decorator on
the route for a per-route one. Both take effect on restart.

Before lowering the API-wide figure, note that it is a *session* budget and the
app's normal cold start is well under it. Before raising it, note that nothing
else stands between a looping client and the database.

The client half — how the app avoids making 429s worse — is in
`fitnessApp/internal/docs/rate-limiting.md`.
