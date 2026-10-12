// End-to-end test of the REAL app (src/main.js) on a virtual screen, driving the panel the way a person would.
const { app, BrowserWindow, screen, shell, session } = require("electron");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const RESULT = process.env.RESULT_FILE;
const SHOTS = process.env.SHOT_DIR || require("os").tmpdir();   // screenshots (a bonus; they need ImageMagick, and are skipped without it)
const PHASE = process.env.PHASE || "1";
const DIR = process.env.TEST_USERDATA;
process.env.OVERWATCH_ADMIN_CHECK_MS = process.env.OVERWATCH_ADMIN_CHECK_MS || "1500";
app.commandLine.appendSwitch("no-sandbox"); app.commandLine.appendSwitch("disable-gpu"); app.setPath("userData", DIR);
const results = []; const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail: ok ? "" : String(detail) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const opened = []; try { shell.openExternal = async (u) => { opened.push(u); }; } catch (e) { check("harness: could stub shell.openExternal", false, e.message); }
const win = () => BrowserWindow.getAllWindows()[0];
const ui = (js) => win().webContents.executeJavaScript(js);
const views = () => win().contentView.children.filter((c) => c.webContents);
const viewShowing = () => views().find((v) => v.getVisible());
const inView = (v, js) => v.webContents.executeJavaScript(js);
const store = () => JSON.parse(fs.readFileSync(path.join(DIR, "overwatch-store.json"), "utf8"));
const docked = (width) => { const d = screen.getPrimaryDisplay().workArea; return { x: d.x + d.width - width, y: d.y, width, height: d.height }; };
const same = (a, b) => ["x", "y", "width", "height"].every((k) => a[k] === b[k]);
const shot = (name) => { try { execFileSync("import", ["-window", "root", `${SHOTS}/${name}-full.png`]); const b = win().getBounds(); execFileSync("convert", [`${SHOTS}/${name}-full.png`, "-crop", `${Math.min(b.width + 40, 1000)}x${Math.min(b.height, 900)}+${Math.max(0, b.x - 20)}+${b.y}`, "+repage", `${SHOTS}/${name}.png`]); } catch (e) { /* screenshots are a bonus */ } };
const tabs = () => ui(`[...document.querySelectorAll('#tabs .tab')].map(t => ({ id: t.dataset.tool, text: t.textContent, active: t.classList.contains('active') }))`);
const tabIds = async () => (await tabs()).map((t) => t.id).join(",");
const clickTab = (id) => ui(`document.querySelector('#tabs .tab[data-tool="${id}"]').click()`);
const cogShown = () => ui("document.getElementById('toggle-settings').hidden === false");
const urlOf = (v) => (v ? v.webContents.getURL() : null);
const finish = async (code = 0) => { try { await session.defaultSession.cookies.flushStore(); } catch (e) {} fs.writeFileSync(RESULT, JSON.stringify(results, null, 1)); app.exit(code); };

(async () => {
  const { start } = require("./stand-in-server.js");
  let { server, state } = await start(3000);
  require("../../../src/main.js");
  await app.whenReady(); await wait(3500);

  if (PHASE === "1") {
    // ---------- 1. startup, NOT signed in ----------
    check("1a docked against the right edge, full height, 380 wide", same(win().getBounds(), docked(380)), JSON.stringify(win().getBounds()));
    check("1b always on top", win().isAlwaysOnTop());
    check("1c exactly one tool page exists, the dispatch console, showing", views().length === 1 && urlOf(views()[0]) === "http://localhost:3000/" && views()[0].getVisible(), views().map(urlOf).join());
    check("1d the page text arrived", (await inView(views()[0], "document.getElementById('marker').textContent")) === "DISPATCH PAGE");
    const t = await tabs();
    check("1e signed out: only Dispatch and Admin tabs, with names; there is NO Reports tab", t.length === 2 && t[0].text === "Dispatch" && t[0].active && t[1].text === "Admin", JSON.stringify(t));
    const chromeH = await ui("Math.ceil(document.getElementById('chrome').getBoundingClientRect().height)");
    const vb = views()[0].getBounds(); const [cw, ch] = win().getContentSize();
    check("1f the tool page starts right under the header and fills the rest", vb.x === 0 && vb.y === chromeH && vb.width === cw && vb.height === ch - chromeH && chromeH > 50 && chromeH < 140, `${JSON.stringify(vb)} chrome ${chromeH}`);
    check("1g no File/Edit/View menu bar is taking room", win().isMenuBarVisible() === false || win().isMenuBarAutoHide());
    check("1h THE SETTINGS COG IS NOT SHOWN to someone who is not signed in as admin", (await cogShown()) === false);
    check("1i the panel knows it is signed out", (await ui("window.overwatch.getSettings().then(s => s.adminSignedIn)")) === false);
    const before = win().getBounds();
    const w = await ui("window.overwatch.setWidth(520)"), sv = await ui("window.overwatch.setServerUrl('http://example.com')"), hd = await ui("window.overwatch.setToolHidden('admin', true)"), ns = await ui("window.overwatch.nextScreen()"), rp = await ui("window.overwatch.showTool('reports')");
    check("1j even by calling the app directly, every settings change is refused while signed out", [w, sv, hd, ns].every((x) => x.ok === false && /Sign in as admin/.test(x.error)) && same(win().getBounds(), before) && store().serverUrl !== "http://example.com", JSON.stringify([w, sv, hd, ns]));
    check("1k ...and so is opening the Reports page; no Reports page was created", rp.ok === false && views().every((v) => !urlOf(v).includes("/reports")));
    shot("s1-signed-out");

    // ---------- 2. signing in ----------
    await clickTab("admin"); await wait(2800);
    check("2a the Admin page loaded inside the panel", urlOf(viewShowing()) === "http://localhost:3000/admin" && (await inView(viewShowing(), "document.getElementById('marker').textContent")) === "ADMIN PAGE");
    check("2b once the sign-in cookie is set the panel notices by itself: the REPORTS TAB APPEARS", (await tabIds()) === "dispatch,admin,reports", await tabIds());
    check("2c the settings cog appears on the Admin screen", (await cogShown()) === true);
    check("2d the panel knows it is signed in", (await ui("window.overwatch.getSettings().then(s => s.adminSignedIn)")) === true);
    check("2e the choice of tab is remembered", store().lastTool === "admin");
    shot("s2-signed-in-admin");

    // ---------- 3. the cog is only on the Admin screen; Reports shows while signed in ----------
    await clickTab("dispatch"); await wait(500);
    check("3a on the Dispatch screen the cog is hidden again (even though signed in)", (await cogShown()) === false);
    check("3b ...but the Reports tab stays while signed in", (await tabIds()) === "dispatch,admin,reports");
    await clickTab("reports"); await wait(1500);
    check("3c the Reports tab opens the Reports page", urlOf(viewShowing()) === "http://localhost:3000/reports" && (await inView(viewShowing(), "document.getElementById('marker').textContent")) === "REPORTS PAGE", urlOf(viewShowing()));
    check("3d no cog on the Reports screen either", (await cogShown()) === false);
    shot("s3-reports");
    await clickTab("admin"); await wait(600);
    check("3e back on the Admin screen the cog returns", (await cogShown()) === true);
    const me = await inView(viewShowing(), "fetch('/whoami').then(r => r.json())");
    check("3f the sign-in cookie (SameSite=Strict) is kept inside the panel and sent back", me.cookie && me.cookie.includes("overwatch_admin=abc123"), JSON.stringify(me));

    // ---------- 4. the burger/overlay switch ----------
    await ui("window.overwatch.setLayout({ chromeHeight: 70, overlay: true })"); await wait(150);
    check("4a while the menu is open the tool page is hidden", views().every((v) => !v.getVisible()));
    await ui("window.overwatch.setLayout({ chromeHeight: 70, overlay: false })"); await wait(150);
    check("4b closing it brings the tool page back", viewShowing() !== undefined);
    await ui("window.overwatch.setLayout({ chromeHeight: 'abc', overlay: 'yes' })"); await wait(300);
    check("4c junk sent to the layout message cannot break it", viewShowing() !== undefined);

    // ---------- 5. settings drawer (Admin screen, signed in) ----------
    const before5 = viewShowing().getBounds().y;
    await ui("document.getElementById('toggle-settings').click()"); await wait(400);
    check("5a opening the drawer pushes the tool page down by its height", viewShowing().getBounds().y > before5 + 100, `${before5} -> ${viewShowing().getBounds().y}`);
    shot("s5-settings");
    await ui("document.getElementById('server-input').value = 'javascript:alert(1)'; document.getElementById('save-server').click()"); await wait(300);
    check("5b an unsafe address is refused with a message and nothing is saved", (await ui("document.getElementById('settings-error').textContent")).includes("Only http and https") && store().serverUrl === "http://localhost:3000");
    check("5b2 the 'Tabs' section is empty (Dispatch, Admin and Reports are not hideable), so it is not shown", (await ui("document.getElementById('tabs-label').hidden")) === true && (await ui("document.querySelectorAll('#tab-toggles input').length")) === 0);
    await ui("document.getElementById('server-input').value = 'http://127.0.0.1:3000'; document.getElementById('save-server').click()"); await wait(3500);
    check("5c a good address is saved and the tool page moves to it", store().serverUrl === "http://127.0.0.1:3000" && urlOf(viewShowing()) === "http://127.0.0.1:3000/admin", `${JSON.stringify(store().serverUrl)} ${urlOf(viewShowing())}`);
    check("5d the NEW server's own sign-in decides: its admin page set its own cookie, so the panel is signed in to it", (await ui("window.overwatch.getSettings().then(s => s.adminSignedIn)")) === true && (await cogShown()) === true);
    await ui("document.getElementById('toggle-settings').click()"); await wait(300);
    await ui("document.getElementById('server-input').value = 'localhost:3000'; document.getElementById('save-server').click()"); await wait(3500);
    check("5e an address typed without http:// is understood", store().serverUrl === "http://localhost:3000", store().serverUrl);

    // ---------- 6. width presets ----------
    check("6a the cog is back after the address change (signed in again)", (await cogShown()) === true);
    await ui("document.getElementById('toggle-settings').click()"); await wait(300);
    await ui("document.querySelector('.preset[data-width=\"520\"]').click()"); await wait(800);
    check("6b 'Wide' makes it 520 and keeps it against the right edge", same(win().getBounds(), docked(520)), JSON.stringify(win().getBounds()));
    check("6c the width is saved, and the tool page followed it", store().window.width === 520 && viewShowing().getBounds().width === win().getContentSize()[0]);
    shot("s6-wide");
    await ui("document.querySelector('.preset[data-width=\"320\"]').click()"); await wait(800);
    check("6d 'Narrow' makes it 320, still docked", same(win().getBounds(), docked(320)), JSON.stringify(win().getBounds()));
    check("6e with one screen there is no 'move to next screen' button", (await ui("document.getElementById('next-screen').hidden")) === true);
    await ui("document.getElementById('toggle-settings').click()"); await wait(300);

    // ---------- 7. it snaps back when something moves it ----------
    win().setBounds({ x: 200, y: 100, width: 320, height: 500 }); await wait(900);
    check("7a moved away from the edge, it docks itself again", same(win().getBounds(), docked(320)), JSON.stringify(win().getBounds()));
    win().setBounds({ x: 900, y: 0, width: 700, height: 1080 }); await wait(900);
    check("7b a wrong size is corrected too", same(win().getBounds(), docked(320)), JSON.stringify(win().getBounds()));

    // ---------- 8. tabs that must stay ----------
    const hdAdmin = await ui("window.overwatch.setToolHidden('admin', true)"), hdRep = await ui("window.overwatch.setToolHidden('reports', true)"), hdDisp = await ui("window.overwatch.setToolHidden('dispatch', true)");
    check("8a the Admin, Dispatch and Reports tabs cannot be hidden, even when signed in and asking directly", [hdAdmin, hdRep, hdDisp].every((x) => x.ok === false) && (await tabIds()) === "dispatch,admin,reports" && !store().hiddenTools.length, JSON.stringify([hdAdmin, hdRep, hdDisp]));

    // ---------- 9. external links ----------
    await clickTab("dispatch"); await wait(700);
    const v = viewShowing(); opened.length = 0;
    await inView(v, "document.getElementById('ext').click()"); await wait(500);
    check("9a a link that opens a new window goes to the real browser, not into the panel", opened.includes("https://example.com/outside") && BrowserWindow.getAllWindows().length === 1, JSON.stringify(opened));
    await inView(v, "document.getElementById('nav').click()"); await wait(700);
    check("9b a link to another site is stopped and opens in the browser instead", opened.includes("https://example.org/navigate") && urlOf(v).startsWith("http://localhost:3000"), `${JSON.stringify(opened)} ${urlOf(v)}`);
    await inView(v, "document.getElementById('popup').click()"); await wait(500);
    check("9c window.open from the page is handled the same way", opened.includes("https://example.com/popup") && BrowserWindow.getAllWindows().length === 1);

    // ---------- 10. the server is down: fail closed ----------
    await new Promise((r) => server.close(r)); await wait(300);
    await ui("document.getElementById('reload-btn').click()"); await wait(3000);
    const body = await inView(viewShowing(), "document.body.innerText");
    check("10a with the server down the tool shows a plain 'Can't reach this tool' page", /Can't reach this tool/.test(body) && /npm run dev/.test(body) && /localhost:3000/.test(body), body.slice(0, 160));
    check("10b ...and tells an admin where to fix a wrong address (the settings file)", /Wrong address\?/.test(body) && /overwatch-store\.json/.test(body), body);
    check("10c with no clear 'yes' from the server the panel assumes NOT signed in: the Reports tab goes away", (await tabIds()) === "dispatch,admin", await tabIds());
    shot("s10-down");
    ({ server, state } = await start(3000)); await wait(300);
    await ui("document.getElementById('reload-btn').click()"); await wait(3000);
    check("10d once the server is back the page recovers", (await inView(viewShowing(), "document.getElementById('marker') && document.getElementById('marker').textContent")) === "DISPATCH PAGE");
    check("10e ...and since the cookie is still valid the Reports tab returns by itself", (await tabIds()) === "dispatch,admin,reports", await tabIds());

    // ---------- 11. tool pages get no access to the app ----------
    const exposed = await inView(viewShowing(), "typeof window.overwatch + '|' + typeof require + '|' + typeof process");
    check("11a a tool page gets no access to the app (no bridge, no Node)", exposed === "undefined|undefined|undefined", exposed);

    // ---------- 12. signing out ----------
    await clickTab("reports"); await wait(1200);
    const reportsView = viewShowing(); const viewsBefore = views().length;
    await inView(reportsView, "fetch('/logout')"); await wait(3000);
    check("12a signing out while on the Reports tab: the Reports tab disappears", (await tabIds()) === "dispatch,admin", await tabIds());
    check("12b ...the panel moves you to Dispatch (you were on an admin-only screen)", urlOf(viewShowing()) === "http://localhost:3000/" && (await tabs()).find((x) => x.active).id === "dispatch", urlOf(viewShowing()));
    check("12c ...the Reports page is thrown away, not just hidden", views().length === viewsBefore - 1 && views().every((x) => !urlOf(x).includes("/reports")), views().map(urlOf).join());
    check("12d ...and the cog is gone", (await cogShown()) === false);
    check("12e ...and the app refuses settings changes again", (await ui("window.overwatch.setWidth(520)")).ok === false);

    // ---------- 13. the server stops accepting a cookie that is still there (a password change) ----------
    await clickTab("admin"); await wait(600);
    await inView(viewShowing(), "fetch('/admin')"); await wait(2500);   // a login: the server sets the cookie, no page load
    check("13a signing in again (a cookie appears with no page load) brings the Reports tab back", (await tabIds()) === "dispatch,admin,reports", await tabIds());
    await inView(viewShowing(), "fetch('/__invalidate')"); await wait(200);
    await ui("document.getElementById('reload-btn').click()"); await wait(2500);
    const cookies = await session.defaultSession.cookies.get({ name: "overwatch_admin", url: "http://localhost:3000" });
    check("13b the cookie is STILL in the browser, but the server says no, so the Reports tab and the cog go away", cookies.length === 1 && (await tabIds()) === "dispatch,admin" && (await cogShown()) === false, `${cookies.length} cookies, tabs ${await tabIds()}`);

    // ---------- 14. the periodic re-check ----------
    await inView(viewShowing(), "fetch('/__validate')");     // the server accepts it again; no page load, no cookie change
    await wait(4500);
    check("14a with nothing else happening, the every-few-minutes re-check notices (here every 1.5 s) and the Reports tab returns", (await tabIds()) === "dispatch,admin,reports", await tabIds());
    await clickTab("reports"); await wait(1200);   // leave it on Reports so the next launch has something to restore
    check("14b the last tab (Reports) is remembered", store().lastTool === "reports");
    await finish(0);
  }

  if (PHASE === "2") {
    // second launch with the same settings folder: still signed in (the cookie persisted), reopens where it was
    check("P2a it comes back docked at the remembered width (320)", same(win().getBounds(), docked(320)), JSON.stringify(win().getBounds()));
    check("P2b the sign-in survived the restart, so the Reports tab is there from the first moment", (await tabIds()) === "dispatch,admin,reports", await tabIds());
    check("P2c it reopens on the last tab, Reports, and loaded it", urlOf(viewShowing()) === "http://localhost:3000/reports", urlOf(viewShowing()));
    check("P2d the settings file is in the new format and the address is remembered", store().version === 2 && store().serverUrl === "http://localhost:3000");
    shot("p2-restart");
    await finish(0);
  }

  if (PHASE === "3") {
    check("P3a an old-format settings file is understood", store().serverUrl === "http://localhost:3000" || store().version === undefined, JSON.stringify(store()));
    check("P3b the panel works, signed out: Dispatch and Admin tabs only, no cog", (await tabIds()) === "dispatch,admin" && (await cogShown()) === false && urlOf(viewShowing()) === "http://localhost:3000/");
    await finish(0);
  }
})().catch(async (e) => { results.push({ name: "CRASH", ok: false, detail: e.stack || String(e) }); fs.writeFileSync(RESULT, JSON.stringify(results, null, 1)); app.exit(2); });
