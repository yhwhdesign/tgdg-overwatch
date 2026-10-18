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
process.env.OVERWATCH_JOBWATCH_POLL_MS = process.env.OVERWATCH_JOBWATCH_POLL_MS || "1000";
app.commandLine.appendSwitch("no-sandbox"); app.commandLine.appendSwitch("disable-gpu"); app.setPath("userData", DIR);
const results = []; const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail: ok ? "" : String(detail) }); if (process.env.SUITE_TRACE) console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : "  <- " + detail}`); };
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
const shot = (name) => { try { execFileSync("import", ["-window", "root", `${SHOTS}/${name}-full.png`], { timeout: 10000 }); const b = win().getBounds(); execFileSync("convert", [`${SHOTS}/${name}-full.png`, "-crop", `${Math.min(b.width + 40, 1000)}x${Math.min(b.height, 900)}+${Math.max(0, b.x - 20)}+${b.y}`, "+repage", `${SHOTS}/${name}.png`], { timeout: 10000 }); } catch (e) { /* screenshots are a bonus */ } };
const tabs = () => ui(`[...document.querySelectorAll('#tabs .tab')].map(t => ({ id: t.dataset.tool, text: t.textContent, active: t.classList.contains('active') }))`);
const tabIds = async () => (await tabs()).map((t) => t.id).join(",");
const clickTab = (id) => ui(`document.querySelector('#tabs .tab[data-tool="${id}"]').click()`);
const cogShown = () => ui("document.getElementById('toggle-settings').hidden === false");
const urlOf = (v) => (v ? v.webContents.getURL() : null);
const bars = () => ui(`[...document.querySelectorAll('#alerts .alert')].map(b => ({ id: b.dataset.alert, title: b.querySelector('.alert-title').textContent, detail: b.querySelector('.alert-detail').textContent }))`);
const moreNote = () => ui(`(document.querySelector('#alerts .alert-more') || {}).textContent || null`);
const watchText = () => ui(`document.getElementById('watch-status').hidden ? null : document.getElementById('watch-status').textContent`);
const watchClass = () => ui(`document.getElementById('watch-status').className`);
const setWatch = (obj) => inView(views()[0], `fetch('/__setjobwatch?json=' + encodeURIComponent(${JSON.stringify(JSON.stringify(obj))}))`);
const doneBarsSimple = () => ui(`[...document.querySelectorAll('#alerts .alert.done')].map(b => b.dataset.alert)`);
const mkAlert = (id, o = {}) => ({ id, jobId: id.split("@")[0], kind: "install", label: "Garage Door Install #4521", techs: ["Alex Tech", "Blake Tech"], startedAt: new Date(Date.now() - 100 * 60000).toISOString(), startedLabel: "9:12 AM", minutesOnJob: 100, limitMinutes: 90, ...o });
const mkDone = (id, o = {}) => ({ id, jobId: id.split("#")[0], kind: "service", label: "Service call #4600", techs: ["Alex Tech"], completedAt: new Date(Date.now() - 20 * 60000).toISOString(), completedLabel: "2:14 PM", minutesOnJob: 65, notes: ["Replaced spring. Needs a quote for a new opener."], notesPending: false, notesHidden: false, ...o });
const barColor = (sel) => ui(`getComputedStyle(document.querySelector(${JSON.stringify(sel)})).backgroundColor`);
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

    // ---------- 1b. JOB WATCH (signed out: it is for dispatchers, not admins) ----------
    const baseY = views()[0].getBounds().y;
    check("JW1 with nothing to report there is no alert bar, and the status says so", (await bars()).length === 0 && (await watchText()) === "No one on a job" && (await watchClass()).includes("ok"), `${await watchText()} / ${await watchClass()}`);
    await setWatch({ watching: 2, alerts: [mkAlert("job_1@90")] }); await wait(2600);
    let b = await bars();
    check("JW2 an alert appears by itself, for someone who is NOT signed in", b.length === 1 && (await cogShown()) === false, JSON.stringify(b));
    check("JW3 it says who, what, and for how long", /^Alex Tech and Blake Tech have been on "Garage Door Install #4521" for 1h 4\dm$/.test(b[0].title), b[0].title);
    check("JW4 ...with the normal limit, when it started, and how to clear it", b[0].detail === "Longer than the normal 1h 30m. Started 9:12 AM. Click to dismiss.", b[0].detail);
    check("JW5 the status shows two techs on jobs", (await watchText()) === "2 on jobs");
    const withAlertY = views()[0].getBounds().y;
    check("JW6 the bar pushes the tool page down (nothing is covered)", withAlertY > baseY + 30, `${baseY} -> ${withAlertY}`);
    shot("s1b-alert");
    await ui("document.querySelector('#alerts .alert').click()"); await wait(500);
    check("JW7 clicking the alert clears it at once", (await bars()).length === 0);
    check("JW8 ...and the tool page moves back up", views()[0].getBounds().y === baseY, `${views()[0].getBounds().y} vs ${baseY}`);
    check("JW9 the dismissal is saved (for a day) so it survives a restart", typeof store().jobWatchDismissed["job_1@90"] === "number", JSON.stringify(store().jobWatchDismissed));
    await wait(2600);
    check("JW10 the next checks still report that job, but it stays dismissed", (await bars()).length === 0);
    await setWatch({ watching: 2, alerts: [mkAlert("job_1@90"), mkAlert("job_2@60", { kind: "service", label: "Service call #12", techs: ["Casey Tech"], minutesOnJob: 70, limitMinutes: 60, startedLabel: "1:05 PM" })] }); await wait(2600);
    b = await bars();
    check("JW11 a different job's alert DOES appear (one dismissed, one new)", b.length === 1 && b[0].id === "job_2@60" && /^Casey Tech has been on "Service call #12" for 1h \d+m$/.test(b[0].title) && b[0].detail.startsWith("Longer than the normal 1h."), JSON.stringify(b));
    // (the real server sends alerts longest-running first, so the stand-in does too)
    await setWatch({ watching: 5, alerts: ["a", "b", "c", "d", "e"].map((x) => mkAlert(`job_${x}@90`, { minutesOnJob: 100 + x.charCodeAt(0) - 96, techs: [`Tech ${x.toUpperCase()}`] })).sort((p, q) => q.minutesOnJob - p.minutesOnJob) }); await wait(2600);
    b = await bars();
    check("JW12 many alerts: three bars and a '+2 more' note (dismiss one to see the next)", b.length === 3 && (await moreNote()) === "+2 more (dismiss one to see the next)", `${b.length} bars, ${await moreNote()}`);
    check("JW13 the panel shows them in the order the server sent: longest-running first", b[0].id === "job_e@90", b.map((x) => x.id).join());
    await ui("document.querySelector('#alerts .alert').click()"); await wait(500);
    b = await bars();
    check("JW14 dismissing one shows the next (still three bars, now '+1 more')", b.length === 3 && (await moreNote()) === "+1 more (dismiss one to see the next)" && !b.some((x) => x.id === "job_e@90"), `${b.map((x) => x.id)} ${await moreNote()}`);
    await setWatch({ watching: 0, alerts: [] }); await wait(2600);
    check("JW15 when the jobs finish the alerts clear themselves, without a click", (await bars()).length === 0 && (await moreNote()) === null && (await watchText()) === "No one on a job");
    await setWatch({ watching: 1, cantTell: 2, ignoredOlder: 1, alerts: [] }); await wait(2600);
    const tip = await ui("document.getElementById('watch-status').title");
    check("JW16 the status tooltip tells you about jobs that cannot be watched (no Start tap) and ones from earlier days", /2 jobs in progress have no Start tap/.test(tip) && /1 job started on an earlier day/.test(tip) && /Last checked/.test(tip), tip);
    await setWatch({ watching: 1, alerts: [{ id: 5 }, null, "x", { label: "no id" }, { id: "ok@60", kind: "weird", label: "<b>Bold</b>", techs: ["T <i>x</i>"], minutesOnJob: "lots", limitMinutes: 60, startedAt: new Date(Date.now() - 70 * 60000).toISOString(), startedLabel: "1:00 PM", customer: "Jane Customer" }] }); await wait(2600);
    b = await bars();
    check("JW17 a malformed answer never breaks the panel: only the one usable alert shows", b.length === 1 && b[0].id === "ok@60", JSON.stringify(b));
    check("JW18 its text is shown as plain text (HTML in it is not interpreted) and the customer field never appears", (await ui("document.querySelectorAll('#alerts b, #alerts i').length")) === 0 && b[0].title.includes("<b>Bold</b>") && !JSON.stringify(b).includes("Jane Customer"), JSON.stringify(b));
    await setWatch({ watching: 1, alerts: [mkAlert("job_down@90")] }); await wait(2600);
    inView(views()[0], "fetch('/__jobwatchdown')"); await wait(4800);
    check("JW19 when Job Watch cannot check three times in a row the status says 'Job Watch offline' (in a warning style)", (await watchText()) === "Job Watch offline" && (await watchClass()).includes("offline"), `${await watchText()} / ${await watchClass()}`);
    check("JW20 ...with the reason in its tooltip, and the alert that was already showing stays until clicked or checked again", /can't check right now: Could not check: Housecall Pro had a problem on its side/.test(await ui("document.getElementById('watch-status').title")) && (await bars()).some((x) => x.id === "job_down@90"));
    await setWatch({ watching: 0, alerts: [] }); await wait(2600);
    check("JW21 when the console recovers the status returns to normal and the stale alert goes", (await watchText()) === "No one on a job" && (await bars()).length === 0, `${await watchText()} / ${(await bars()).length}`);
    // The console is put behind its sign-in: Job Watch says what to do, then recovers by itself once you have signed in on the Dispatch tab.
    await setWatch({ watching: 1, alerts: [mkAlert("signin@90")] }); await wait(2600);
    inView(views()[0], "fetch('/__requireconsole')"); await wait(2600);
    check("JW21b behind the console sign-in and not signed in: the status tooltip says to sign in on the Dispatch tab", /Sign in on the Dispatch tab to turn Job Watch on/.test(await ui("document.getElementById('watch-status').title")), await ui("document.getElementById('watch-status').title"));
    check("JW21c ...and the alert that was already showing is kept, not wiped", (await bars()).some((x) => x.id === "signin@90"));
    inView(views()[0], "fetch('/__consolesignin')"); await wait(3200);
    check("JW21d after signing in (the cookie lands in the panel's own session) Job Watch recovers without a restart", !/Sign in on the Dispatch tab/.test(await ui("document.getElementById('watch-status').title")) && /^1 on a job$/.test(await watchText()), `${await watchText()} / ${await ui("document.getElementById('watch-status').title")}`);
    inView(views()[0], "fetch('/__norequireconsole')"); await setWatch({ watching: 0, alerts: [] }); await wait(2600);
    const longId = await ui("window.overwatch.dismissJobWatch('x'.repeat(500))"), numId = await ui("window.overwatch.dismissJobWatch(42)"), emptyId = await ui("window.overwatch.dismissJobWatch('')");
    check("JW22 asking the app to dismiss something nonsensical is refused", [longId, numId, emptyId].every((x) => x.ok === false), JSON.stringify([longId, numId, emptyId]));
    check("JW23 (the panel page can ask; tool pages cannot: they have no bridge at all)", (await ui("typeof window.overwatch.dismissJobWatch")) === "function" && (await inView(views()[0], "typeof window.overwatch")) === "undefined");
    await setWatch({ watching: 0, alerts: [] }); await wait(1500);
    check("JW24 the layout is back to normal at the end", views()[0].getBounds().y === baseY);

    // ---------- 1b2. JOB WATCH: "Go to job" opens the ticket in the real browser ----------
    const JOBURL = "https://pro.housecallpro.com/app/jobs/job_222bc7db334e4898992bffe4b472bf00";
    const gos = () => ui(`[...document.querySelectorAll('#alerts [data-goto]')].map(b => ({ id: b.dataset.goto, text: b.textContent, inBar: !!b.closest('button.alert') }))`);
    await setWatch({ watching: 3, alerts: [mkAlert("job_g1@90", { url: JOBURL }), mkAlert("job_g2@90", { url: "https://evil.example.com/steal" }), mkAlert("job_g3@90", { url: "javascript:alert(1)" })] }); await wait(2600);
    let g = await gos();
    check("GJ1 only the bar with a safe Housecall Pro link gets a 'Go to job' button (off-site and javascript: links get none), and it is not inside the dismiss button", g.length === 1 && g[0].id === "job_g1@90" && g[0].text === "Go to job" && !g[0].inBar && (await bars()).length === 3, JSON.stringify(g));
    opened.length = 0;
    await ui("document.querySelector('[data-goto=\"job_g1@90\"]').click()"); await wait(600);
    check("GJ2 clicking it opens that ticket in the real browser", opened.length === 1 && opened[0] === JOBURL, JSON.stringify(opened));
    check("GJ3 ...and does NOT dismiss the bar", (await bars()).some((b) => b.id === "job_g1@90") && !store().jobWatchDismissed["job_g1@90"], JSON.stringify(store().jobWatchDismissed));
    opened.length = 0;
    const spoof = await ui(`Promise.all([window.overwatch.openJobWatchJob('job_g2@90'), window.overwatch.openJobWatchJob('job_nope'), window.overwatch.openJobWatchJob('https://evil.example.com/'), window.overwatch.openJobWatchJob(5)])`);
    check("GJ5 asking for an off-site, unknown or made-up id opens nothing", opened.length === 0 && spoof.every((r) => r.ok === false), JSON.stringify([opened, spoof]));
    await setWatch({ watching: 1, alerts: [mkAlert("job_g4@90", { url: "http://pro.housecallpro.com/x" })], completed: [mkDone("job_g5#1", { url: JOBURL })] }); await wait(2600);
    g = await gos(); opened.length = 0;
    await ui(`document.querySelector('[data-goto="job_g5#1"]').click()`); await wait(600);
    check("GJ4 the green finished-job bar works the same way (and a plain http link gets no button)", g.length === 1 && g[0].id === "job_g5#1" && opened.length === 1 && opened[0] === JOBURL && (await doneBarsSimple()).includes("job_g5#1"), JSON.stringify([g, opened]));
    await setWatch({ watching: 0, alerts: [], completed: [] }); await wait(2600);

    // ---------- 1c. JOB WATCH: a tech has FINISHED a job (green bar with the notes) ----------
    const doneBars = () => ui(`[...document.querySelectorAll('#alerts .alert.done')].map(b => ({ id: b.dataset.alert, title: b.querySelector('.alert-title').textContent, detail: b.querySelector('.alert-detail').textContent, notes: b.querySelector('.alert-notes').textContent, notesNone: b.querySelector('.alert-notes').classList.contains('none'), hint: b.querySelector('.alert-hint').textContent, tooltip: b.title }))`);
    await setWatch({ completed: [mkDone("job_9#1")] }); await wait(2600);
    let d = await doneBars();
    check("JC1 a finished job appears as a green bar: who, what, when, how long it took", d.length === 1 && d[0].title === 'Alex Tech finished "Service call #4600"' && d[0].detail === "Finished 2:14 PM after 1h 5m.", JSON.stringify(d));
    check("JC2 ...with the tech's notes shown in it", d[0].notes === "Replaced spring. Needs a quote for a new opener.", JSON.stringify(d[0]));
    check("JC3 ...a 'click to dismiss' hint, and the full notes in the tooltip", d[0].hint === "Click to dismiss." && d[0].tooltip === "Replaced spring. Needs a quote for a new opener.", JSON.stringify(d[0]));
    check("JC4 it is green, clearly different from the red-orange overtime bar", (await barColor("#alerts .alert.done")) === "rgb(31, 111, 74)", await barColor("#alerts .alert.done"));
    check("JC5 it pushes the tool page down like any bar", views()[0].getBounds().y > baseY + 40, `${baseY} -> ${views()[0].getBounds().y}`);
    shot("s1c-finished");
    await ui("document.querySelector('#alerts .alert.done').click()"); await wait(500);
    check("JC6 clicking it dismisses it, saves that, and the page moves back", (await bars()).length === 0 && typeof store().jobWatchDismissed["job_9#1"] === "number" && views()[0].getBounds().y === baseY, JSON.stringify(store().jobWatchDismissed));
    await wait(2600);
    check("JC7 the next checks still list it, but it stays dismissed", (await bars()).length === 0);
    await setWatch({ completed: [mkDone("job_9#1"), mkDone("job_10#2", { notes: [], notesPending: false })] }); await wait(2600);
    d = await doneBars();
    check("JC8 no notes and not fresh: 'No notes were left.' (in a quieter style)", d.length === 1 && d[0].notes === "No notes were left." && d[0].notesNone === true && d[0].tooltip === "Click to dismiss", JSON.stringify(d));
    await setWatch({ completed: [mkDone("job_10#2", { notes: [], notesPending: true, minutesOnJob: null })] }); await wait(2600);
    d = await doneBars();
    check("JC9 fresh with no notes yet: says they may still appear; with no Start tap it just says when it finished", d[0].notes === "No notes yet. They will appear here if the tech adds them." && d[0].detail === "Finished 2:14 PM.", JSON.stringify(d));
    await setWatch({ completed: [mkDone("job_10#2", { notes: ["Done. Customer wants a gate opener estimate."], notesPending: false })] }); await wait(2600);
    d = await doneBars();
    check("JC10 when the tech types the notes a minute later the SAME bar fills in (one bar, not two)", d.length === 1 && d[0].notes === "Done. Customer wants a gate opener estimate." && d[0].id === "job_10#2", JSON.stringify(d));
    await setWatch({ completed: [mkDone("job_10#2", { notes: ["Secret gate code 4471"], notesHidden: true })] }); await wait(2600);
    d = await doneBars();
    check("JC11 with notes switched off at the server the bar says so and shows no note text", d[0].notes === "Notes are turned off." && !JSON.stringify(d).includes("4471"), JSON.stringify(d));
    await setWatch({ watching: 1, alerts: [mkAlert("job_over@90")], completed: [mkDone("job_11#3"), mkDone("job_12#4"), mkDone("job_13#5")] }); await wait(2600);
    b = await bars();
    check("JC12 mixed: the overtime alert comes FIRST, then finished jobs; three bars and a '+1 more' note", b.length === 3 && b[0].id === "job_over@90" && b[1].id === "job_11#3" && (await moreNote()) === "+1 more (dismiss one to see the next)", `${b.map((x) => x.id)} ${await moreNote()}`);
    check("JC13 the first is the red-orange overtime bar, the others are green", (await barColor("#alerts .alert:not(.done)")) === "rgb(194, 65, 12)" && (await doneBars()).length === 2);
    const longNotes = ["A".repeat(300), "B".repeat(300), "C".repeat(300)];
    await setWatch({ completed: [mkDone("job_long#6", { notes: longNotes })] }); await wait(2600);
    check("JC14 very long notes are limited to 8 lines on screen (the full text stays in the tooltip)", (await ui("getComputedStyle(document.querySelector('#alerts .alert-notes')).webkitLineClamp")) === "8" && (await doneBars())[0].tooltip.includes("C".repeat(300)));
    await setWatch({ completed: [mkDone("job_html#7", { label: "<b>Bold</b>", notes: ["<img src=x onerror=alert(1)> and <script>1</script>"] })] }); await wait(2600);
    check("JC15 HTML in a note or title is shown as text, never run", (await ui("document.querySelectorAll('#alerts img, #alerts script, #alerts b').length")) === 0 && (await doneBars())[0].notes.includes("<img src=x onerror=alert(1)>") && (await doneBars())[0].title.includes("<b>Bold</b>"));
    await setWatch({ completed: [{ id: 5 }, null, "x", { label: "no id" }, { id: "ok#1", label: "Tidy", techs: "Alex", notes: [1, null, "fine", "  "], customer: "Jane Customer", minutesOnJob: "lots" }] }); await wait(2600);
    d = await doneBars();
    check("JC16 a malformed finished list never breaks the panel: only the usable entry shows, tidied, and no customer field appears", d.length === 1 && d[0].id === "ok#1" && d[0].title === 'A technician finished "Tidy"' && d[0].notes === "fine" && d[0].detail === "Finished just now." && !JSON.stringify(d).includes("Jane"), JSON.stringify(d));
    await setWatch({ completed: [] }); await wait(2600);
    check("JC17 when the finished jobs are old enough that the server stops listing them the bars go by themselves", (await bars()).length === 0 && views()[0].getBounds().y === baseY);

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
    let b2;
    await setWatch({ watching: 2, alerts: [mkAlert("job_1@90"), mkAlert("job_fresh@90", { techs: ["Drew Tech"] })] }); await wait(2800);
    b2 = await bars();
    check("P2f an alert dismissed BEFORE the restart is still dismissed after it, and a new one shows", b2.length === 1 && b2[0].id === "job_fresh@90" && typeof store().jobWatchDismissed["job_1@90"] === "number", JSON.stringify(b2) + JSON.stringify(store().jobWatchDismissed));
    await setWatch({ completed: [mkDone("job_9#1"), mkDone("job_new#8", { label: "Opener install #12", notes: ["All good."] })] }); await wait(2800);
    b2 = await bars();
    check("P2g a finished-job bar dismissed BEFORE the restart is still dismissed after it, and a new one shows", b2.length === 1 && b2[0].id === "job_new#8" && typeof store().jobWatchDismissed["job_9#1"] === "number", JSON.stringify(b2));
    shot("p2-restart");
    await finish(0);
  }

  if (PHASE === "3") {
    check("P3a an old-format settings file is understood", store().serverUrl === "http://localhost:3000" || store().version === undefined, JSON.stringify(store()));
    check("P3b the panel works, signed out: Dispatch and Admin tabs only, no cog", (await tabIds()) === "dispatch,admin" && (await cogShown()) === false && urlOf(viewShowing()) === "http://localhost:3000/");
    await finish(0);
  }
})().catch(async (e) => { results.push({ name: "CRASH", ok: false, detail: e.stack || String(e) }); fs.writeFileSync(RESULT, JSON.stringify(results, null, 1)); app.exit(2); });
