# Tests for the desktop panel

```bash
npm test             # the decisions (docking maths, which tabs fit, safe addresses, who sees what), in a second
npm run test:e2e     # the REAL app, driven like a person would (about a minute and a half)
```

## What `npm run test:e2e` does
It starts the actual panel (`src/main.js`) with a small stand-in for the dispatch console (`e2e/stand-in-server.js`: two pages, a sign-in cookie, the yes/no session check) and drives the panel's own buttons. Four runs:

1. **Full walk-through:** docked at the right edge; signed-out view (no cog, no Reports); signing in makes the Reports tab and the cog appear by themselves; the cog only on the Admin screen; the sign-in cookie really sticks inside the panel; settings drawer; unsafe addresses refused; widths; snapping back when moved; links that leave a tool open in the real browser; the server being down; tool pages cannot reach the app; **signing out, a password change and the periodic re-check**; settings changes refused when signed out even by calling the app directly.
   It also walks through **Job Watch**: alerts appear for someone who is not signed in; the bar pushes the tool page down and the page moves back when it is clicked away; a dismissed alert stays dismissed on the next checks and after a restart; several alerts stack (three and a "+N more"); alerts clear by themselves when the jobs finish; a malformed answer from the server never breaks the panel (and HTML in it is shown as plain text); and the status says "Job Watch offline" after three failed checks and recovers. It also covers the console sign-in: behind it and not signed in, the status says to sign in on the Dispatch tab (the bar already showing is kept), and Job Watch recovers by itself once the sign-in cookie exists in the panel's session. It also covers the green **finished-job** bars: notes shown, the "No notes yet" bar filling itself in, "No notes were left", notes switched off, a long note limited to 8 lines with the full text in the tooltip, HTML in a note shown as plain text, overtime bars ordered before finished ones, dismissal persisting across checks and a restart. It also covers **Go to job**: the button shows only for safe Housecall Pro links (off-site, `javascript:` and plain `http` links get none), opens the ticket through the real browser without dismissing the bar, works on red and green bars, and the panel refuses off-site, unknown or made-up ids. It also covers the **estimate** bars: a waiting estimate (days with no answer) and a finished field estimate (options and amounts), both with a "Go to estimate" button that opens the right estimate without dismissing the bar.
2. **Restart:** the sign-in, width, last tab and dismissed alerts survive a restart.
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
