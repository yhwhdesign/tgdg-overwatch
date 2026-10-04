# TGDG Overwatch

A small desktop app that pins itself to the right edge of your screen and stays there — a docked panel for dispatch tools (starting with the zip/tech/availability console), alongside whatever browser (or anything else) happens to be open. Not a browser extension: this works the same way regardless of Chrome, Edge, Firefox, or Safari, because it doesn't depend on any of them.

See `project_state.md` for full architecture notes, decisions, and task split.

## Run it (development)
```bash
npm install
npm start
```
A window opens pinned to the right edge of your primary display, showing the icon rail and whichever tool is active.

## Package it as a real app (unsigned, free)
```bash
npm run dist
```
Produces an unpacked app under `release/` for your platform (macOS `.app`, Windows portable `.exe`, or Linux `AppImage`, depending on what you build on). This is **unsigned** — that's intentional, to stay at zero cost (a real Apple Developer Program membership is $99/year and isn't needed here).

### Opening an unsigned app on macOS
Since macOS Sequoia, Control-click-to-open no longer bypasses Gatekeeper. Instead:
1. Try to open the app — it'll say it can't be verified.
2. Go to **System Settings → Privacy & Security**, scroll down, click **Open Anyway** next to the app.
3. Confirm **Open**. After this once, it opens normally going forward.

This is a one-time step per machine, same category of friction as "Load unpacked" was for the browser-extension approach — no ongoing cost either way.

### Opening an unsigned app on Windows
Windows SmartScreen will warn once; click **More info → Run anyway**. Same one-time-per-machine deal.

## Adding a new docked tool
Edit `src/tools.js` — add an entry to the `TOOLS` array with an `id`, `name`, `defaultUrl`, and a one-character `glyph` for the icon rail. Restart the app. That's the whole process.

## Pointing a tool at a real URL
Each tool defaults to `http://localhost:3000`. Click the gear icon in the panel to override it per tool — saved to a small JSON file in the app's user-data folder, so it's remembered across restarts.

## Structure
- `src/main.js` — Electron main process: creates the docked window, pins it to the screen edge, handles the tiny JSON-file storage
- `src/preload.js` — secure bridge exposing storage to the panel's UI (context isolation stays on; no Node access leaks into the renderer)
- `src/sidepanel.html` / `.css` / `.js` — the panel UI itself (icon rail, settings, iframe)
- `src/tools.js` — the tool registry

## The first tool: dispatch console
`tools/dispatch-console/` is a separate Next.js app (its own `package.json`, run independently) — it's the content the panel's one registered tool loads by URL. See `tools/dispatch-console/README.md` for its own setup. Run it with `npm run dev` from inside that folder, on port 3000, which is what `src/tools.js` points at by default.

## Known gaps
- Not code-signed or notarized — see the "opening an unsigned app" notes above
- Only one tool registered so far (the dispatch console), pointed at localhost until it's deployed somewhere real
- Window position is recalculated on launch from the primary display only — multi-monitor setups aren't specially handled yet
