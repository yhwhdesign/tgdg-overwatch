# Tests for the desktop panel

```bash
npm test             # the decisions (docking maths, which tabs fit, safe addresses, who sees what), in a second
npm run test:e2e     # the REAL app, driven like a person would (about a minute and a half)
```

## What `npm run test:e2e` does
It starts the actual panel (`src/main.js`) with a small stand-in for the dispatch console (`e2e/stand-in-server.js`: two pages, a sign-in cookie, the yes/no session check) and drives the panel's own buttons. Four runs:

1. **Full walk-through:** docked at the right edge; signed-out view (no cog, no Reports); signing in makes the Reports tab and the cog appear by themselves; the cog only on the Admin screen; the sign-in cookie really sticks inside the panel; settings drawer; unsafe addresses refused; widths; snapping back when moved; links that leave a tool open in the real browser; the server being down; tool pages cannot reach the app; **signing out, a password change and the periodic re-check**; settings changes refused when signed out even by calling the app directly.
2. **Restart:** the sign-in, width and last tab survive a restart.
3. **Old settings file:** the previous version's settings format still loads.
4. **Burger menu:** a throwaway copy of the app with ten tools (`e2e/ten-tool-app.js`).

## Requirements
- `npm install` in the top folder (Electron).
- **Port 3000 must be free**: stop `npm run dev` first (the stand-in uses that port).
- On a **Mac or Windows PC** real windows open on your screen for about a minute. That is normal; do not touch the mouse while it runs.
- On **Linux without a screen** (or CI) it uses `xvfb-run` automatically (`sudo apt install xvfb`). That is how these were first verified.
- Screenshots are saved if ImageMagick is installed (the path is printed at the end); otherwise they are skipped.

## One known platform difference
Locking the window against dragging (`movable: false`) is honoured on macOS and Windows but not on Linux. The "snaps itself back if moved" safety net covers Linux and is what the test exercises. The macOS and Windows behaviour of the lock itself has not been run by the test.
