# TGDG Overwatch

A small desktop app that pins itself to the right edge of your screen and stays there — a docked panel for dispatch tools (starting with the zip/tech/availability console), alongside whatever browser (or anything else) happens to be open. Not a browser extension: this works the same way regardless of Chrome, Edge, Firefox, or Safari, because it doesn't depend on any of them.

See `project_state.md` for full architecture notes, decisions, and task split.

## Run it (development)
```bash
npm install
npm start
```
A window opens docked against the right edge of your screen. The tools it shows are web pages served by the dispatch console, so start that first (`npm run dev` inside `tools/dispatch-console`, on port 3000). If it is not running, the panel says so plainly and tells you what to do.

## What the panel does
- **Always docked.** It sits against the right edge of the screen's usable area (below the menu bar, above the taskbar), full height. It cannot be dragged off, and if anything moves it anyway (a window manager, a monitor being plugged in or removed, a restore) it snaps itself back within a fraction of a second. It stays on top, including over full-screen apps on a Mac. If you have more than one monitor, **Move to next screen** in the settings drawer picks the one it lives on, and it remembers the choice (and falls back to the main screen if that monitor is unplugged).
- **Width.** Narrow (320), Standard (380) or Wide (520), in the settings drawer (the gear). It never takes more than 60% of a small screen, and it remembers your choice.
- **Tabs, and who sees what.** One tab per tool, with names when there is room and one-letter tabs when there is not; when there are more tabs than fit, a **burger menu** (the three-line button) lists every tool by name, and the tab you are on is never hidden. Everyone sees **Dispatch** and **Admin**. The **Reports** tab appears only while you are signed in as admin, and disappears again when you sign out, the 12-hour sign-in runs out, or the password is changed. The panel reopens on the tab you last used.
- **The settings cog is for admins only, and only on the Admin screen.** A dispatcher never sees it. It appears (top right) only when you are signed in as admin AND looking at the Admin tab. Inside it: the server address, the panel width, which screen to live on, and the tab toggles. The app itself also refuses every settings change unless the server confirms an admin sign-in, so it cannot be done by other means either.
- **How the panel knows you are an admin.** The sign-in is a cookie that lives with the tool pages; the panel never reads it. Instead the app asks the server a plain yes-or-no (`/api/admin/session`, no database involved) through the same session the tool pages use, and asks again whenever the cookie changes, whenever a page finishes loading, when the window comes to the front, and every 5 minutes. **If it cannot get a clear "yes" (server down, odd answer), it treats you as signed out**, so nothing admin-only shows by mistake.
- **A wrong server address and no way to fix it?** The cog needs a working admin sign-in, which needs the server. If the address is wrong, the "can't reach this tool" page prints the settings file's location; edit `serverUrl` in that file (it is a small JSON file) and restart the panel.
- **Each tool is a real page, not an embedded frame.** That is what lets the Admin sign-in work inside the panel (a frame cannot keep that cookie), and it means the tool sees nothing of the app: no bridge, no Node. A link that tries to open a new window, or to leave the tool's site, opens in your normal browser instead.
- **One server address for every tab.** Set it once in the drawer (`http://localhost:3000` today). When the dispatch console moves online, change that one setting. Anything typed there is checked: only `http` and `https` addresses are accepted.
- **Job Watch alerts.** A bar across the very top of the panel, on every tab, when a technician has been on a job longer than normal (an install over 90 minutes, other work over 60; see the console's README). It reads, for example: *Alex Tech has been on "Garage Door Install #4521" for 1h 42m. Longer than the normal 1h 30m. Started 9:12 AM. Click to dismiss.* Click it and it is gone, and stays gone (for a day, even after a restart); it also clears by itself when the job is finished. The dock icon bounces on a Mac (the taskbar button flashes on Windows) when a new one appears. When a tech **finishes a job** a calmer **green** bar appears: *Alex Tech finished "Service call #4600". Finished 2:14 PM after 1h 5m.* with the job's notes underneath, so you can tell at a glance whether anything further is needed; click it to dismiss it (it is a notification, not a list, and is kept for a few hours only). A fresh finish with no notes says "No notes yet" and fills in by itself if the tech types them a few minutes later. Overtime bars come first, then finished jobs. Up to three bars show, with a "+N more" note. Next to the tool name a small status shows "2 on jobs", "No one on a job" or "Job Watch offline" (hover it for details). Everyone sees these; they do not need an admin sign-in.
- **Only one copy runs.** Starting it a second time brings the first forward instead of opening a second panel.
- **Limit worth knowing:** an app cannot reserve screen space on a Mac, so a maximized browser still sits underneath the panel. Snap the browser to the left part of the screen (macOS and Windows window snapping) so the two sit side by side.

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
Edit `src/tools.js` and add an entry to the `TOOLS` array: an `id`, a `name`, a `shortName` for the tab, a one-character `glyph`, and the `path` on the server (for example `"/jobwatch"`). Optional flags: `core: true` (never hideable), `adminOnly: true` (only listed while signed in as admin, like Reports), `hostsPanelSettings: true` (the settings cog shows on this tool's screen; only Admin has it). Restart the app. That is the whole process.

## Structure
- `src/main.js`: the Electron main process. Creates the docked window, keeps it docked, places each tool's page under the panel's header, handles the settings file and the messages from the panel.
- `src/shell-logic.js`: the decisions (where to dock, which tabs fit, which addresses are safe, how to read old settings), kept free of Electron so they can be tested on their own.
- `src/preload.js`: the small, fixed set of things the panel's own page may ask the app to do.
- `src/sidepanel.html` / `.css` / `.js`: the panel's header (tabs, burger menu, settings drawer).
- `src/tools.js`: the tool registry.
- The settings live in a small JSON file in the app's user-data folder. The older format (one address per tool) is understood and becomes the shared server address.

## The first tool: dispatch console
`tools/dispatch-console/` is a separate Next.js app (its own `package.json`, run independently) — it's the content the panel's one registered tool loads by URL. See `tools/dispatch-console/README.md` for its own setup. Run it with `npm run dev` from inside that folder, on port 3000, which is what `src/tools.js` points at by default.

## Tests
```bash
npm test             # the panel's decisions (fast)
npm run test:e2e     # the real app, driven like a person (about a minute and a half; stop the dev server first, it uses port 3000)
cd tools/dispatch-console && npm test     # the console: about 30 seconds, no database or network
```
See `tests/shell/README.md` and `tools/dispatch-console/tests/README.md` for what each one covers.

## Known gaps
- Not code-signed or notarized: see the "opening an unsigned app" notes above.
- Tools are the dispatch console and Admin so far; Job Watch, the Estimate Tracker and Inventory are planned (see `project_state.md`).
- The panel cannot reserve screen space, so a maximized browser sits underneath it (see above).
