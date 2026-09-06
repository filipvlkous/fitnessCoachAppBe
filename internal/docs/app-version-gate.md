# `GET /app-version` — the forced update gate

Public, no token. Tells the app the oldest version this backend is willing to
serve; anything below it refuses to run and sends the user to the store.

```
GET /app-version
{ "data": { "minSupported": "0.0.38", "latest": "0.0.40",
            "iosUrl": "…", "androidUrl": "…" },
  "message": "App version policy fetched successfully." }
```

Unauthenticated on purpose. An app old enough to be broken is broken on the
sign-in screen too, and a guard here would mean an expired session was the
reason someone never got told to update.

## Configuration

| Variable             | Notes |
| -------------------- | ----- |
| `MIN_APP_VERSION`    | The floor. **Unset means no gate** — the app never blocks. |
| `LATEST_APP_VERSION` | Served, unused by the app today. |
| `IOS_STORE_URL`      | Shared with the invite page in `src/join`. |
| `ANDROID_STORE_URL`  | Same. |

Raising the floor is an env change plus a restart — no deploy, and above all no
app release, which is the whole reason the number lives here.

Set `MIN_APP_VERSION` to the oldest version still worth serving (typically the
one before a breaking API change), **not** to the newest release — the latter
blocks everyone who has simply not updated yet.

## Malformed values are ignored

`version()` in the controller accepts only a dotted run of digits. `v1.2`,
`1.2.3-beta` and `latest` all resolve to `null`, i.e. no gate. This number is
the one piece of config that can lock every user out of a working app, so a
typo has to fail towards leaving it open rather than towards blocking everyone.

The client half — how the comparison works and every other way it fails open —
is in `fitnessApp/internal/docs/app-version-gate.md`.
