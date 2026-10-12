# Tests for the dispatch console

```bash
npm test                 # everything (about 30 seconds)
npm test -- events       # only suites whose file name contains "events"
```

Nothing here touches a real database, a real Housecall Pro account or the network. Everything runs against in-memory fakes and tiny local servers, so it is safe to run any time, anywhere. Needs Node 22+ (see `.nvmrc`; the TypeScript tests run directly on Node, no build step) and `npm install` done once (the UI tests use `esbuild` and `jsdom`, both dev dependencies).

Some suites run several times on purpose, in different server time zones (Chicago, UTC, Tokyo, Auckland). The schedule logic must give the same answer wherever the server runs, and a bug that only shows in one zone is exactly the kind that would otherwise appear after hosting moves.

## What is covered

| Folder | Suite | What it protects |
|---|---|---|
| `unit/` | `availability` | Business hours, the 120-day sync window, time zones, how far ahead dispatch can book |
| | `schedule-gaps-and-stacking` | The open-time cards, "best fit" between nearby calls, zip-distance scoring, events shown as blocked time |
| | `hcp-sync-jobs` | Turning Housecall Pro jobs into stored appointments (the rules for which technician and which times) |
| | `events-sync`, `repeat-rules` | Calendar events, including weekly/monthly repeating events (RFC 5545 rules), one row per occurrence per person |
| | `events-client`, `hcp-client-errors` | The Housecall Pro client: sign-in scheme, rate-limit retries, forward reading by start time, readable error messages |
| | `webhook-signature-and-hcp-client` | Webhook signature checking |
| | `hcp-read-only` | **Every request ever sent to Housecall Pro is a read (GET).** This test fails if that ever stops being true. |
| | `diagnose` | The "why does the console show this?" checker |
| | `classification-and-admin-session` | Residential / Commercial / Hybrid rules; the admin password and sign-in cookie |
| | `sync-status`, `auto-sync-controller` | The "Schedule as of ..." freshness states and the refresh timer (backs off while failing, only runs during business hours) |
| `scripts/` | `events-probe`, `events-survey` | The command-line tools in `scripts/` |
| `ui/` | `console-flow`, `admin-screen`, `reports-page` | The screens, clicked through in a simulated browser |
| `server/` | `offered-technicians-route`, `hcp-sync-route`, `refresh-and-status`, `admin-session-route` | The API routes: who is offered, the sync endpoint, Refresh now and the status routes, the admin yes/no check |

## Adding a test
Put a file in the matching folder, make it print `N passed, M failed` and exit non-zero on any failure, and add one line to the list in `run-all.mjs`. Scratch files the UI and server suites need are written to `tests/.tmp/` (git-ignored).

## Not covered here
The real Housecall Pro account and the real database (those are checked by hand with `scripts/hcp-diagnose.mjs` and the Admin screen), and the desktop panel, which has its own suites in the repo's top-level `tests/` folder.
