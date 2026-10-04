# TGDG Overwatch — Project State

_Last updated: 2026-10-03_

## What this is
**TGDG Overwatch**: a small desktop app that pins itself to the right edge of the screen and stays there — a docked panel for dispatch tools (starting with the zip/tech/availability console), alongside whatever browser the dispatcher has open (Housecall Pro today, other tools later). Overwatch is a *shell*, not one hard-wired tool — the zip/tech/availability console is the first thing it loads, not the whole product.

Team: lead full-stack dev + a UI/UX specialist (persona, brought in for panel/shell design specifically) + a junior dev. Both the lead dev and UX talk directly to the user as a 10+ year full-stack dev who's rusty and re-ramping — not a beginner, just out of practice.

## Architecture decision: desktop app, not a browser extension (2026-10-03)
Started as three separate browser extensions (Chrome/Edge via `chrome.sidePanel`, Firefox via `sidebar_action`), with Safari out of scope since it has no sidebar API at all. That approach is **retired**. Instead, Overwatch is now a small **Electron app**:
- Opens its own window, pinned to the right edge of the primary display, on launch
- Works identically regardless of which browser is open next to it — Chrome, Edge, Firefox, Safari, or none of them — because it doesn't depend on any browser's extension APIs
- One codebase instead of three manifest variants
- Can stay visible even when no browser window is focused (not tied to being "inside" a specific browser's chrome)

Trade-off, stated plainly: it's no longer "lives in the browser's toolbar" — it's a separate small app the dispatcher launches once and leaves pinned to the screen edge. For an internal tool, that's considered a fair trade for genuine any-browser support and a single codebase.

## Zero-cost plan (verified via research)
- Electron itself: free, MIT-licensed, no platform fee of any kind.
- Distribution: unsigned builds via `electron-builder`, genuinely $0. On macOS (post-Sequoia), opening an unsigned app requires System Settings → Privacy & Security → "Open Anyway" once per machine (Control-click bypass no longer works as of Sequoia) — a one-time step, not a recurring cost. Windows SmartScreen has an equivalent one-time "Run anyway" click.
- Hosting: Neon (Postgres) and Vercel stay on free tiers for the dispatch console's backend, unchanged from before.
- **The only real dollar figure anywhere in this plan:** a signed/notarized macOS build via the Apple Developer Program would cost $99/year — not part of the current plan, only relevant if this ever needs to be distributed more broadly without the one-time Gatekeeper click.

## Architecture
- `src/main.js` — Electron main process: creates the docked `BrowserWindow`, positions it against the screen's work area (excludes OS menu bar/taskbar), handles a tiny JSON-file-backed storage via IPC
- `src/preload.js` — exposes that storage to the renderer as `window.overwatch`, with context isolation on and no Node integration in the renderer (standard Electron security practice)
- `src/sidepanel.html/.css/.js` — the panel UI: icon rail across the top, a settings gear for overriding the active tool's URL, an iframe showing the active tool
- `src/tools.js` — the tool registry. Each tool is just `{ id, name, defaultUrl, glyph }` loaded in an iframe; adding a new docked tool means adding one entry here, not rebuilding anything
- The existing dispatcher console backend (Next.js + Prisma + Neon) is the first tool's content, loaded by URL — that work isn't thrown away, it's just one iframe's worth of content now instead of the whole product

## Repo
Single repo: **`tgdg-overwatch`**, structured as a monorepo:
- Repo root — the Electron shell (`src/main.js`, `src/preload.js`, panel UI)
- `tools/dispatch-console/` — the first docked tool, a standalone Next.js app with its own `package.json`, run independently (`npm run dev` inside that folder) and deployed separately later (e.g. Vercel, with its "Root Directory" set to `tools/dispatch-console`)

The original `tgdg-zip-dispatcher` repo's code did not survive its deletion — the dispatch console was fully rebuilt from scratch on 2026-10-03 (see Log), reconstructed accurately since the working logic was still available from earlier in the build process, including the color-theme bug fix applied from the start this time rather than patched after.

## Task split
- **Lead dev (full-stack):** Electron main process, window positioning/docking behavior, the tool registry, storage/IPC, packaging via `electron-builder`.
- **UI/UX specialist:** panel layout, tool-switcher design (currently a horizontal icon rail — chosen as the simplest thing that scales to more tools later), the visual language for an always-on shell (calm/utility-grade, not a one-time booking flow).
- **Junior dev:** per-tool UI work (starting with the existing dispatcher console), Vercel deployment of that console, eventually an admin screen for registering new tool URLs.

## Dispatch console (rebuilt, now at `tools/dispatch-console/`)
- HCP account must be on the MAX plan for API + webhooks
- Webhook + backfill hybrid pattern for availability data (webhook receiver verifies signatures and logs events; actual DB upsert on receipt still TODO)
- Data model: `Technician`, `ZipCoverage`, `Appointment`, `WebhookEvent`
- Same-day / next-day / dynamic-later-window availability logic (`availability.ts`), wired to real Prisma queries in both API routes
- Tech auto-suggest ranking (soonest opening: today > tomorrow > later)
- Brand colors (black `#16140f`, cream `#f4f2ea`, orange `#e97530`) — correct from the start this time
- No seed data yet — needs at least one `Technician` + `ZipCoverage` row to show anything real

## Open questions / not yet decided
- Multi-monitor behavior — window positioning currently only considers the primary display
- Whether to eventually pursue a signed/notarized build ($99/year) for wider distribution, or stay unsigned indefinitely
- HCP MAX plan status — still unconfirmed from earlier sessions

## Log
- 2026-09-29: Original architecture (webhook+backfill hybrid, `zip_coverage` table) designed for what started as a customer-facing booking app. Repo `tgdg-zip-dispatcher` scaffolded, Neon DB provisioned, first migration run successfully.
- 2026-09-30: Built the real availability engine and Prisma-backed API routes; pivoted from customer-facing booking to an internal dispatcher console; added a Chrome/Edge side panel extension; found and fixed a theme-variable bug that had silently broken all brand colors.
- 2026-09-30 (later): Retired the single-purpose app model in favor of **TGDG Overwatch** as a cross-browser extension shell. Verified real cross-browser and cost constraints via research. Old repo retired; new repo `tgdg-overwatch` created; initial three-browser-extension scaffold built (Chrome/Edge + Firefox manifests, shared panel UI, build script).
- 2026-10-03: Retired the browser-extension approach entirely in favor of a small **Electron desktop app** that docks itself to the screen edge regardless of browser — solves Safari for free as a side effect and collapses three manifest variants into one codebase. Rebuilt the panel UI (icon rail, settings, iframe) on top of Electron's main/preload/renderer model with JSON-file storage. Old extension-specific files (manifests, per-browser build script) removed.
- 2026-10-03 (later): Confirmed the old `tgdg-zip-dispatcher` repo's code did not survive. Rebuilt the dispatch console from scratch as `tools/dispatch-console/` inside this same repo (monorepo decision made and closed, not left open) — full Prisma schema, availability engine, HCP client/webhook verification, and the branded three-tier UI, all verified clean (tsc + eslint, zero errors) and with the color-theme bug fixed from the start rather than patched in after.
