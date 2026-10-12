# Dispatch Console

The first tool Overwatch docks. An internal dispatcher tool for The Garage Door Guy Corp — zip code → eligible technician (auto-suggested, overridable) → same-day/next-day/further-out availability, pulled from a Housecall Pro-backed cache.

This is a normal Next.js app, run independently of Overwatch itself. Overwatch just loads whatever URL this ends up running at (localhost while developing, a real deployed URL later) inside its panel's iframe.

## Requirements
- A Housecall Pro account on the **MAX plan** (required for both the API and webhooks)
- A Neon Postgres database
- Node 20+

## Setup
```bash
npm install
cp .env.example .env   # fill in DATABASE_URL, HCP_API_KEY, HCP_WEBHOOK_SIGNING_SECRET
npx prisma generate
npx prisma migrate dev --name init
npm run dev
```
Runs on `http://localhost:3000` by default — same URL Overwatch's `tools.js` registry points at out of the box.

## Structure
- `prisma/schema.prisma` — `Technician`, `Appointment`, `WebhookEvent` (`ZipCoverage` is unused and kept only to avoid a migration)
- `src/lib/hcp-client.ts` — HCP API wrapper
- `src/lib/verify-webhook.ts` — HCP webhook signature verification
- `src/lib/availability.ts` — the actual scheduling engine (same-day/next-day/dynamic-later-window logic)
- `src/app/api/webhooks/housecall/route.ts` — webhook receiver (verify → upsert)
- `src/app/api/availability/route.ts`, `src/app/api/offered-technicians/route.ts` — real Prisma-backed endpoints: one technician's open time, and who is offered for a call (with their best opening for this customer's zip)
- `src/app/page.tsx` — the dispatcher console UI

## Open time, shaded bookings, and stacking calls by zip
For the chosen technician the console draws each day as a bar: **shaded (striped) time is already booked** (labeled with that call's zip, and never clickable), white is open, and open time that sits next to calls near the customer is tinted orange. Below each bar only the **open gaps** are listed, each with the call before it and the call after it and how far away those are.
- **Best fit:** with the customer's zip, a gap *between two calls in the same or a nearby zip* beats a gap *next to one such call*, which beats plain open time. The best one is called out at the top of the times screen with a one-tap Book button, and the technician list is ordered the same way (best fit first, "Suggested" on top), also showing each tech's soonest opening.
- **Start times:** every 30 minutes, plus one right after the call before a gap and one that ends right as the next call begins, since those are the ones that actually stack jobs back to back.
- **"Nearby"** means the same zip, or an estimated drive of 10 minutes or less. The estimate is the straight-line distance between the centers of two zip codes, stretched for roads and converted at 30 mph (`src/lib/zip-distance.ts`; change `NEAR_DRIVE_MINUTES` there). It is an estimate, not directions. Zip centers come from `src/data/ar-zip-centroids.ts` (Arkansas only); a zip outside Arkansas has unknown distance, so only an exact same-zip match counts for it.
- Job zips come from the HCP job address and are stored as 5 digits. The sync keeps only the zip, never the street address.
- Not modeled: travel time between back-to-back calls. A start time flush against a call assumes zero driving, so check the "about N min away" note.

## Choosing who takes which calls (Admin screen)
After the zip code, the dispatcher picks **Residential** or **Commercial**, and the console offers only technicians who cover that zip **and** are classified for that kind of call. You classify people on the Admin screen at **/admin** (open it in a normal browser tab, e.g. `http://localhost:3000/admin`, not inside the Overwatch panel):
- It lists the people synced from Housecall Pro, with three round buttons per person: **R** Residential (residential calls only), **C** Commercial (commercial calls only), **H** Hybrid (both). Tap the highlighted one again to remove someone.
- Anyone not marked is never offered. Marking an admin or office person works too.
- Sign-in uses the single password in the `ADMIN_PASSWORD` environment variable (a long random one; leave it empty to switch Admin off entirely). It is a signed, expiring (12 hour), HttpOnly, SameSite=Strict cookie, with a limit of 5 wrong guesses per address per 5 minutes.
- Run `node scripts/hcp-sync.mjs --write` first so there are people to list. **Zip codes never limit who is offered**: anyone marked here is offered in every zip, and the customer's zip is only used to find open time next to nearby calls.

## Syncing from Housecall Pro
The console reads technicians and appointments from our own database, which is filled from HCP in two ways:

1. **Backfill / re-sync (manual):** `node scripts/hcp-sync.mjs` is a **dry run** (shows what would change, writes nothing). Add `--write` to apply. It copies HCP employees into `Technician` (only `field tech` role starts active) and jobs from midnight today through 30 days ahead into `Appointment` (one row per job per assigned technician). It is forward-looking only: anything that already ended is cleared, and it never pulls HCP's full history (it asks HCP for that date window and aborts if HCP seems to have ignored the filter). Needs `HCP_API_KEY` and `ADMIN_SYNC_SECRET` in `.env`, and `npm run dev` running.
   - `--retire-demo`: deactivate the seeded demo technician.
2. **Webhooks (live):** `/api/webhooks/housecall` verifies HCP's signature, then re-reads the changed job from the HCP API and updates our rows, so a reschedule/cancel/reassignment shows up without a manual sync. Every event is stored in `WebhookEvent` for inspection.

`scripts/hcp-probe.mjs` is a read-only discovery tool that prints the shape of HCP's responses (customer fields masked).

HCP's scheduled block is stored as-is (real start/end). Any policy such as "treat each job as busy for N minutes" belongs at read time in the availability code, not in the sync.

## Why isn't booked time showing? (diagnose)
`node scripts/hcp-diagnose.mjs "Drayton Wilson" 2026-10-07` (date optional, defaults to tomorrow; needs `npm run dev` running and `ADMIN_SYNC_SECRET`) is a read-only report for one person and one day. It asks Housecall Pro what is really scheduled (job-level schedule, every appointment, who is assigned and who is dispatched), checks whether our sync would record it, checks whether our database actually has it, and prints plain-English findings: stale data, a multi-day job whose first visit began before our sync window, a visit that is only a separate appointment, someone dispatched but not assigned, a canceled job, or nothing found (an Estimate or calendar Event instead of a job). It prints staff names, job-id endings, statuses, job type labels and times only; never customer details. Jobs that HCP has **archived** (finished and hidden; HCP answers `400 Archived job` when asked for their appointments) are flagged and skipped rather than stopping the report, and the look-back skips jobs that are already finished or canceled since they can't have a visit still to come. If the job list itself carries a field mentioning "archive", the report prints it. The server stamps each answer with the report's code version, and the script tells you plainly if the running `npm run dev` is still on older files (stop it with Ctrl+C, `rm -rf .next`, start it again).

## Calendar events (errands, time off, meetings)
Housecall Pro has a second kind of calendar item besides jobs: **Events**, used to block a tech's time (for example "go get product" before a job, PTO, a meeting). The sync now reads them too (`GET /events`) and stores each one as blocked time for every person assigned to it, marked `kind = "event"` with a short title (at most 60 characters). Every event blocks time and every event is shown.
- **On screen:** events get their own color and pattern (steel-blue cross-hatch, versus gray stripes for jobs), and each is also written out under that day's bar with its hours and title (for example "Event 7:00 AM - 8:30 AM: Product pickup"), so a new dispatcher can see WHY someone isn't available. A day where an event is the only thing in the way is still shown ("Nothing open this day"). An event is a boundary for open time but never counts as a nearby call for stacking.
- **Careful reading:** the event fields were not known when this was written, so the reader is defensive. It attaches an event only to people found under assignee-style fields (never a "created by" id), never uses a repeat-series end date as the event's end, skips all-day events given only as dates, and reports anything it cannot read by id ending, reason and FIELD NAMES (never values) in the sync output under `events.unreadable`.
- **Safety:** events have their own cleanup (rows marked as events only), so the job sync can never delete them and vice versa. If HCP's events list fails, the job sync still completes and the report shows the reason under `events.error`. An empty answer from HCP never wipes stored events.
- **Freshness:** events are only as fresh as the last sync (no live updates for them that we know of).
- **Events are read forward, from today on.** Housecall Pro ignores date ranges on its events list (and lists events newest-created-first by default), but it DOES accept `sort_by=start_time&sort_direction=desc`. So the sync reads events furthest-future first and stops as soon as it reaches events that began more than 21 days before the window (the look-back catches a multi-day event already under way). At your scale that is about 4 pages instead of 39, under a second instead of half a minute. Guards: the first request must be accepted, every event must really arrive in non-increasing start order, and a page where no start can be read never counts as "reached the past". If any guard fails it falls back to reading EVERY event (the old way) and says so in `events.notes`. A read that takes over 150 seconds stops with a clear message, and never triggers a second, bigger read.
- The report shows `pages` read versus `totalPages` HCP has, `totalItems`, `seconds`, `notes` (how the read went, in plain English), how many events are `distinct`, and `duplicateEntries`. The server window prints a line per page, and `hcp-sync.mjs` prints a heartbeat so it is never silent.
- Known limit: the forward read looks back 120 days before today (`EVENTS_LOOKBACK_DAYS` in `src/lib/hcp-sync.ts`), so an event that began longer ago than that and is still running is not seen by it.
- **Repeating events:** each stored row is keyed `event:<id>@<start time>`, so several occurrences that share one id are all kept, and an identical copy counts once.
- **Repeating events.** Housecall Pro lists a repeating event ONCE, at its first occurrence, with a rule such as `FREQ=WEEKLY;INTERVAL=1;WKST=SU;BYDAY=MO`. The sync expands daily, weekly and monthly rules (INTERVAL, COUNT, UNTIL, BYDAY including "2TU" and "-1FR", BYMONTHDAY, WKST) into one row per occurrence inside the window, keeping the local clock time across daylight saving (verified against the examples in the repeat-rule standard, RFC 5545). Any rule it does not understand is NOT guessed: the first occurrence is kept and the rule is listed under `events.repeating.details` with the reason. `events.repeating` also shows each series, how many occurrences fall in the window, and `visibleUntil`: the date after which the normal read stops reaching the series (its first occurrence falls outside the 120-day look-back). That is a known limit; the durable fix is storing series definitions, planned together with automatic syncing.
- **Zero-length events** (end equals start, so there is nothing to block) are skipped quietly as `no-duration`.
- **Events we could not read** are listed under `events.unreadable` with their times, all-day flag, repeat rule, headcount and creation date (never titles, notes, addresses or people).
- `node scripts/hcp-events-survey.mjs` is a read-only survey of every event: repeated ids, repeat rules, all-day and odd-time events, whether the list is newest-created-first, and how far ahead of time events get created (which decides whether we can stop reading early). Its last section (8) also tries a dozen tiny requests to find out whether Housecall Pro can sort events by start time or filter them to today-forward; if one works, the sync can read only the future events instead of all of history.
- `node scripts/hcp-events-probe.mjs "Drayton Wilson" 2026-10-08` is a read-only probe that shows what an event looks like in HCP's data and lists that person's events for the day. Titles stay hidden unless you add `--titles`.

## Keeping the schedule fresh (automatic refresh and the "schedule as of" badge)
- **One refresh, three ways to start it.** `src/lib/run-sync.ts` is the single "refresh from Housecall Pro" function. It is started by (1) `node scripts/hcp-sync.mjs --write`, (2) the **Refresh now** button on the Admin screen, and (3) an automatic timer. Only one refresh runs at a time (a second one is refused politely), and every real refresh records when it worked, or why it failed, in the `SyncStatus` table (a dry run records nothing).
- **The timer** starts with the server (`src/instrumentation.ts`), refreshes once about 5 seconds after startup and then every `AUTO_SYNC_MINUTES` (default 10), only during `AUTO_SYNC_HOURS` (default 6-19, in the business time zone). It backs off (10, 20, then up to 30 minutes) while something keeps failing, and recovers by itself. It only works on a server that stays running (your computer, a VPS). On serverless hosting (Netlify, Vercel) nothing stays running: set `AUTO_SYNC_MINUTES=0` and have a scheduler call `POST /api/admin/hcp-sync?dryRun=0` with the `x-admin-secret` header every 10 minutes (for example a free GitHub Actions schedule).
- **Why 10 minutes and business hours only.** The database is on Neon's free plan: it sleeps after 5 idle minutes and includes 100 CU-hours a month (about 400 hours at the smallest size). A database that never sleeps would use about 180, and at the limit the compute is suspended until the next month. The timer never runs faster than every 5 minutes and pauses overnight so the database can sleep. The console's status check is also answered from memory (10 minutes in business hours, 60 outside them), and a hidden tab does not poll, so a tab left open overnight does not keep the database awake.
- **The badge** in the console header says "Schedule as of 3:26 PM, 4 min ago" in calm text, turns **amber** when the data is older than the limit (it uses its own clock, so it warns even if it has not heard from the server lately) and **red** when refreshing is failing (with a short, safe reason such as "the database could not be reached"; never a host name or key). Outside the refresh hours it says updates are paused until morning instead of alarming. `GET /api/sync-status` feeds it.
- **The Admin panel** ("Keeping the schedule fresh") shows each part (jobs and calendar events): when it last worked, who started it, how long it took, and, for admins only, the fuller error text. It shows the timer's schedule and next run, or why there is no timer on this server, and has the **Refresh now** button.
- **First time:** run `npx prisma migrate dev --name sync-status` (adds the small `SyncStatus` table), then restart. If the Neon database was asleep and the command says it can't reach it, wait half a minute and run it again.

## Tests
`npm test` runs every suite in about 30 seconds, with no database, no Housecall Pro account and no network (see `tests/README.md`). It includes a test that fails if the app ever sends anything but a read request to Housecall Pro.

Type-checking on a **fresh clone**: Next generates a few of its own types (such as `LayoutProps`) the first time you run `npm run dev` or `npm run build`; before that, `npx tsc --noEmit` reports `Cannot find name 'LayoutProps'`. Run `npx next typegen` once and it is clean.

## Reports (admin only) and the sign-in check
- `/reports` is the admin-only home for Housecall Pro reporting. For now it just says there is nothing there yet. It shows nothing to anyone who is not signed in as admin, and the desktop panel only lists the **Reports** tab while an admin is signed in.
- `GET /api/admin/session` answers `{ enabled, signedIn }`: a plain yes or no, never an error, so the desktop panel can use it to decide whether to show Reports and its settings cog. It only checks the sign-in cookie's signature and expiry (no database, no data), says no for a tampered cookie, an expired one, one signed with an older password, or when `ADMIN_PASSWORD` is empty, and cannot be changed by anything sent to it (it only answers GET).
- When real reports are added, their data routes must use `adminGate` like the other admin routes; hiding a tab is not security.

## Deploying (Netlify)
Netlify detects Next.js automatically. Site settings:
- **Base directory:** `tools/dispatch-console` (this app is a subfolder of the Overwatch repo)
- **Build command:** `npm run build` (default) &nbsp;|&nbsp; **Publish directory:** leave blank (auto-detected)
- **Do not add a `netlify.toml`**; the base directory is set in the Netlify UI. Node version comes from `.nvmrc`.
- **Environment variables:** `DATABASE_URL`, `HCP_API_KEY`, `HCP_WEBHOOK_SIGNING_SECRET`, `BUSINESS_HOURS_START`, `BUSINESS_HOURS_END`, `BUSINESS_TIMEZONE` (see `.env.example`). Never commit real values.
- `prisma/schema.prisma` lists the `rhel-openssl-3.0.x` binary target so the database engine matches Netlify's runtime, and `postinstall` runs `prisma generate` on every install.

Servers run in UTC, so business hours and "today/tomorrow" are always computed in `BUSINESS_TIMEZONE`, never the server's clock (see `src/lib/availability.ts`).

## Not yet wired up
- Webhook receiver logs events but doesn't upsert into the DB yet (dedupe + actual Appointment/Technician updates still TODO)
- Backfill job (seed historical jobs/appointments via REST API) not yet written
- Admin screen: classification (R/C/H) only; nothing else is editable there yet
- Booking confirmation write-back to HCP not yet built
- First run: sync from HCP, then mark technicians R/C/H on `/admin`, otherwise the console has no one to offer
