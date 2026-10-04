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
- `prisma/schema.prisma` — `Technician`, `ZipCoverage`, `Appointment`, `WebhookEvent`
- `src/lib/hcp-client.ts` — HCP API wrapper
- `src/lib/verify-webhook.ts` — HCP webhook signature verification
- `src/lib/availability.ts` — the actual scheduling engine (same-day/next-day/dynamic-later-window logic)
- `src/app/api/webhooks/housecall/route.ts` — webhook receiver (verify → upsert)
- `src/app/api/availability/route.ts`, `src/app/api/zip-coverage/route.ts` — real Prisma-backed endpoints, including tech auto-suggest ranking
- `src/app/page.tsx` — the dispatcher console UI

## Not yet wired up
- Webhook receiver logs events but doesn't upsert into the DB yet (dedupe + actual Appointment/Technician updates still TODO)
- Backfill job (seed historical jobs/appointments via REST API) not yet written
- Admin screen for managing `ZipCoverage` not yet built
- Booking confirmation write-back to HCP not yet built
- No seed data — you'll need at least one `Technician` and matching `ZipCoverage` row to see anything besides empty states
