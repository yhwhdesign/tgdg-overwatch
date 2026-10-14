const L = require("../../src/shell-logic.js");
let passes = 0, failures = 0;
const check = (n, ok, d = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${n}${d ? "  <- " + d : ""}`); } };
const eq = (n, a, b) => check(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);

// ================= A. docking =================
eq("A1 a 1920x1080 screen: 380 wide against the RIGHT edge, full height", L.dockBounds({ x: 0, y: 0, width: 1920, height: 1080 }, 380), { x: 1540, y: 0, width: 380, height: 1080 });
eq("A2 below a Mac menu bar: starts under it and uses the rest of the height", L.dockBounds({ x: 0, y: 25, width: 1440, height: 875 }, 380), { x: 1060, y: 25, width: 380, height: 875 });
eq("A3 a taskbar on the right shrinks the usable area, and the panel sits against it", L.dockBounds({ x: 0, y: 0, width: 1860, height: 1040 }, 380), { x: 1480, y: 0, width: 380, height: 1040 });
eq("A4 a second monitor to the LEFT (negative x): docked to ITS right edge", L.dockBounds({ x: -1440, y: 0, width: 1440, height: 900 }, 380), { x: -380, y: 0, width: 380, height: 900 });
eq("A5 a second monitor to the right", L.dockBounds({ x: 1920, y: 0, width: 1920, height: 1080 }, 520), { x: 3320, y: 0, width: 520, height: 1080 });
eq("A6 too narrow is raised to 280", L.clampWidth(100, 1920), 280);
eq("A7 too wide is capped at 640", L.clampWidth(2000, 3840), 640);
eq("A8 never more than 60% of a small screen (a 1000 px screen allows 600)", L.clampWidth(640, 1000), 600);
eq("A8 ...and a tiny 400 px screen still gets the 280 minimum", L.clampWidth(380, 400), 280);
eq("A9 junk falls back to 380", [L.clampWidth(NaN, 1920), L.clampWidth("wide", 1920), L.clampWidth(undefined, 1920), L.clampWidth(null, 1920)], [380, 380, 380, 380].map((x, i) => (i === 3 ? 280 : x)));
eq("A10 a width given as text is understood", L.clampWidth("450", 1920), 450);
eq("A11 odd widths are rounded to whole pixels", L.clampWidth(399.6, 1920), 400);
eq("A12 the presets are narrow 320, standard 380, wide 520", L.WIDTH_PRESETS.map((p) => [p.id, p.width]), [["narrow", 320], ["standard", 380], ["wide", 520]]);
check("A13 every preset survives clamping on a normal screen", L.WIDTH_PRESETS.every((p) => L.clampWidth(p.width, 1920) === p.width));

// ================= B. which screen =================
const D = (id, x, y = 0, w = 1920) => ({ id, bounds: { x, y, width: w, height: 1080 } });
const screens = [D(7, 1920), D(3, 0), D(9, -1920)];
eq("B1 the chosen screen is used when it exists", L.pickDisplay(screens, 3, 7).id, 7);
eq("B2 if the chosen screen is unplugged, the main one", L.pickDisplay(screens, 3, 42).id, 3);
eq("B3 with no choice made, the main one", L.pickDisplay(screens, 3, null).id, 3);
eq("B3 ...also for undefined", L.pickDisplay(screens, 3, undefined).id, 3);
eq("B4 a chosen id of 0 is a real choice, not 'no choice'", L.pickDisplay([D(0, 0), D(5, 1920)], 5, 0).id, 0);
eq("B5 if the main one is somehow missing, the first one", L.pickDisplay([D(8, 0)], 3, null).id, 8);
eq("B6 no screens at all gives nothing, never a crash", L.pickDisplay([], 3, null), null);
eq("B7 next screen goes left to right and wraps: -1920 -> 0 -> 1920 -> -1920", [L.nextDisplay(screens, 9).id, L.nextDisplay(screens, 3).id, L.nextDisplay(screens, 7).id], [3, 7, 9]);
eq("B8 with one screen 'next' is that same screen", L.nextDisplay([D(1, 0)], 1).id, 1);
eq("B9 an unknown current screen starts from the leftmost one", L.nextDisplay(screens, 99).id, 9);
eq("B10 two screens stacked vertically are ordered top to bottom", L.nextDisplay([D(1, 0, 1080), D(2, 0, 0)], 2).id, 1);
eq("B11 the input list is not reordered", screens.map((d) => d.id), [7, 3, 9]);

// ================= C. where the tool's page goes =================
eq("C1 below the header, filling the rest", L.toolBounds({ width: 380, height: 1000 }, 70), { x: 0, y: 70, width: 380, height: 930 });
eq("C2 a header taller than the window leaves nothing, never negative", L.toolBounds({ width: 380, height: 50 }, 120), { x: 0, y: 120, width: 380, height: 0 });
eq("C3 fractional heights are rounded", L.toolBounds({ width: 380, height: 1000 }, 69.6), { x: 0, y: 70, width: 380, height: 930 });
eq("C4 same-bounds helper", [L.sameBounds({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 4 }), L.sameBounds({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 5 }), L.sameBounds(null, { x: 1 })], [true, false, false]);

// ================= D. tabs and the burger menu =================
const T = (id, shortName) => ({ id, shortName, glyph: id[0].toUpperCase(), name: shortName });
const two = [T("dispatch", "Dispatch"), T("admin", "Admin")];
let r = L.layoutTabs(two, "dispatch", 350);
eq("D1 two tabs in a 350 px bar: full names, no menu", [r.mode, r.visible.map((t) => t.id), r.showMenu], ["names", ["dispatch", "admin"], false]);
r = L.layoutTabs(two, "dispatch", 120);
eq("D2 not enough room for names: glyph-only tabs, still no menu", [r.mode, r.visible.length, r.showMenu], ["glyphs", 2, false]);
const six = [T("dispatch", "Dispatch"), T("admin", "Admin"), T("jobwatch", "Job Watch"), T("estimates", "Estimates"), T("inventory", "Inventory"), T("reports", "Reports")];
r = L.layoutTabs(six, "dispatch", 340);
check("D3 six tabs in 340 px: glyph tabs with names too wide; capacity = (340-40)/36 = 8 so all six fit as glyphs", r.mode === "glyphs" && r.visible.length === 6 && !r.showMenu, JSON.stringify(r.visible.map((t) => t.id)));
r = L.layoutTabs(six, "dispatch", 150);
eq("D4 six tabs in 150 px: 3 glyphs fit ((150-40)/36) and the burger menu holds the other 3", [r.mode, r.visible.map((t) => t.id), r.overflow.map((t) => t.id), r.showMenu], ["glyphs", ["dispatch", "admin", "jobwatch"], ["estimates", "inventory", "reports"], true]);
r = L.layoutTabs(six, "inventory", 150);
eq("D5 the ACTIVE tab is never hidden: it takes the last visible slot", [r.visible.map((t) => t.id), r.overflow.map((t) => t.id)], [["dispatch", "admin", "inventory"], ["jobwatch", "estimates", "reports"]]);
r = L.layoutTabs(six, "dispatch", 60);
eq("D6 even a tiny bar shows at least one tab plus the menu", [r.visible.map((t) => t.id), r.showMenu, r.overflow.length], [["dispatch"], true, 5]);
r = L.layoutTabs(six, "nonexistent", 150);
eq("D7 an unknown active id just shows the first tabs", r.visible.map((t) => t.id), ["dispatch", "admin", "jobwatch"]);
r = L.layoutTabs(two, "dispatch", 0);
eq("D8 an unmeasured bar (width 0) shows everything with names instead of hiding things", [r.mode, r.visible.length, r.showMenu], ["names", 2, false]);
eq("D9 no tools at all is fine", L.layoutTabs([], null, 300), { mode: "names", visible: [], overflow: [], showMenu: false });
check("D10 nothing is lost: visible + overflow is always every tab", [60, 100, 150, 200, 260, 340, 500].every((w) => { const x = L.layoutTabs(six, "estimates", w); return x.visible.length + x.overflow.length === 6 && new Set([...x.visible, ...x.overflow].map((t) => t.id)).size === 6; }));
check("D11 the active tab is visible at EVERY width", [60, 100, 150, 200, 260, 340, 500].every((w) => L.layoutTabs(six, "reports", w).visible.some((t) => t.id === "reports")));

// ================= E. addresses =================
const url = (s) => L.normalizeServerUrl(s);
eq("E1 a normal address", url("http://localhost:3000"), { ok: true, url: "http://localhost:3000" });
eq("E2 spaces trimmed, a trailing slash dropped", url("  https://app.example.com/  "), { ok: true, url: "https://app.example.com" });
eq("E3 no scheme: http:// is added", url("example.com"), { ok: true, url: "http://example.com" });
eq("E4 host:port without a scheme is a host, not a scheme", url("localhost:3000"), { ok: true, url: "http://localhost:3000" });
eq("E5 an address with a port and no scheme, on a network", url("192.168.1.20:3000"), { ok: true, url: "http://192.168.1.20:3000" });
eq("E6 https is accepted", url("https://tgdg.vercel.app"), { ok: true, url: "https://tgdg.vercel.app" });
for (const bad of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "file:///etc/passwd", "data:text/html,<script>1</script>", "ftp://example.com", "chrome://settings", "about:blank", "vbscript:x"]) {
  const x = url(bad); check(`E7 "${bad}" is refused`, x.ok === false && /http/i.test(x.error), JSON.stringify(x));
}
eq("E8 empty is refused with a helpful message", url("   ").ok === false && /Enter a web address/.test(url("").error), true);
check("E9 nonsense is refused", url("http://").ok === false && url("http://:::").ok === false);
check("E10 a null or undefined input cannot crash it", url(null).ok === false && url(undefined).ok === false);
eq("E11 a path is kept (a server living under a path)", url("https://x.com/dispatch/"), { ok: true, url: "https://x.com/dispatch" });
eq("E12 joining a server and a path", [L.joinUrl("http://localhost:3000", "/admin"), L.joinUrl("http://localhost:3000/", "/"), L.joinUrl("https://x.com/app", "/admin"), L.joinUrl(undefined, "/admin"), L.joinUrl("http://a.com", "admin")], ["http://localhost:3000/admin", "http://localhost:3000", "https://x.com/app/admin", "http://localhost:3000/admin", "http://a.com/admin"]);
const tools = [{ id: "dispatch", path: "/" }, { id: "admin", path: "/admin" }];
eq("E13 each tool is the shared server plus its path", tools.map((t) => L.toolUrl(t, { serverUrl: "https://tgdg.app", toolUrls: {} })), ["https://tgdg.app", "https://tgdg.app/admin"]);
eq("E14 a tool-specific address wins over the shared one", L.toolUrl(tools[1], { serverUrl: "https://tgdg.app", toolUrls: { admin: "http://other:9" } }), "http://other:9");

// ================= F. saved settings =================
const known = ["dispatch", "admin", "jobwatch"];
let s = L.normalizeSettings(undefined, known);
eq("F1 nothing saved: complete defaults", s, { version: 2, serverUrl: "http://localhost:3000", toolUrls: {}, hiddenTools: [], lastTool: null, window: { width: 380, displayId: null }, jobWatchDismissed: {} });
check("F2 garbage of every kind gives defaults, never a crash", [null, 5, "x", [], [1, 2], true].every((g) => JSON.stringify(L.normalizeSettings(g, known)) === JSON.stringify(s)));
s = L.normalizeSettings({ dispatch: "http://localhost:3000" }, known);
eq("F3 the OLD file format ({dispatch: url}) is understood and becomes the shared server address", [s.version, s.serverUrl], [2, "http://localhost:3000"]);
s = L.normalizeSettings({ dispatch: "http://192.168.1.50:3000/something" }, known);
eq("F4 ...using just its origin", s.serverUrl, "http://192.168.1.50:3000");
s = L.normalizeSettings({ dispatch: "javascript:alert(1)" }, known);
eq("F5 an unsafe old address is ignored", s.serverUrl, "http://localhost:3000");
const saved = { version: 2, serverUrl: "https://tgdg.app/", toolUrls: { admin: "http://x:1", ghost: "http://y:2", jobwatch: "javascript:1" }, hiddenTools: ["admin", "admin", "ghost", 5], lastTool: "admin", window: { width: 520, displayId: 7 } };
s = L.normalizeSettings(saved, known);
eq("F6 a good new-format file is kept", [s.serverUrl, s.lastTool, s.window], ["https://tgdg.app", "admin", { width: 520, displayId: 7 }]);
eq("F7 per-tool addresses: unknown tools and unsafe addresses are dropped", s.toolUrls, { admin: "http://x:1" });
eq("F8 hidden tools: duplicates and unknown ids are dropped", s.hiddenTools, ["admin"]);
s = L.normalizeSettings({ version: 2, lastTool: "ghost", serverUrl: "nonsense:::", window: { width: 99999, displayId: {} } }, known);
eq("F9 an unknown last tool, a bad server address and a silly width all fall back safely", [s.lastTool, s.serverUrl, s.window.width, s.window.displayId], [null, "http://localhost:3000", 640, null]);
s = L.normalizeSettings({ version: 2, window: { width: 100, displayId: "abc" } }, known);
eq("F10 a width below the minimum is raised; a text display id is kept", [s.window.width, s.window.displayId], [280, "abc"]);
const input = { version: 2, hiddenTools: ["admin"] }; const copy = JSON.stringify(input); L.normalizeSettings(input, known);
eq("F11 the input is never modified", JSON.stringify(input), copy);

// ================= G. who sees what =================
const REG = require("../../src/tools.js").TOOLS;
const ids = (list) => list.map((t) => t.id);
eq("G1 the real registry: Dispatch, Admin and Reports", ids(REG), ["dispatch", "admin", "reports"]);
eq("G2 Dispatch and Admin can never be hidden; Reports is admin-only; only Admin hosts the settings", [REG.map((t) => !!t.core), REG.map((t) => !!t.adminOnly), REG.map((t) => !!t.hostsPanelSettings)], [[true, true, false], [false, false, true], [false, true, false]].map((x, i) => (i === 2 ? [false, true, false] : x)).map((x, i) => (i === 2 ? [false, true, false] : x)));
eq("G3 signed OUT: Reports is not listed", ids(L.visibleTools(REG, [], false)), ["dispatch", "admin"]);
eq("G4 signed IN: Reports is listed", ids(L.visibleTools(REG, [], true)), ["dispatch", "admin", "reports"]);
eq("G5 only an exact true counts as signed in (undefined, 'yes', 1 do not)", [undefined, null, "yes", 1, 0, ""].map((v) => ids(L.visibleTools(REG, [], v)).includes("reports")), [false, false, false, false, false, false]);
eq("G6 a hidden tool is not listed", ids(L.visibleTools([{ id: "a" }, { id: "b" }], ["b"], false)), ["a"]);
eq("G7 a core tool cannot be hidden, even if the settings file says so", ids(L.visibleTools(REG, ["dispatch", "admin"], false)), ["dispatch", "admin"]);
eq("G8 an admin-only tool stays unlisted even if it is not hidden and no flag is given", ids(L.visibleTools(REG, [])), ["dispatch", "admin"]);
eq("G9 no tools, no hidden list: fine", [L.visibleTools([], [], true), L.visibleTools(undefined, undefined, true)], [[], []]);
const adminTool = REG.find((t) => t.id === "admin"), dispatchTool = REG.find((t) => t.id === "dispatch"), reportsTool = REG.find((t) => t.id === "reports");
eq("G10 the settings cog: only a signed-in admin, on the Admin screen", [L.settingsButtonVisible(true, adminTool), L.settingsButtonVisible(true, dispatchTool), L.settingsButtonVisible(true, reportsTool), L.settingsButtonVisible(false, adminTool), L.settingsButtonVisible(undefined, adminTool), L.settingsButtonVisible("yes", adminTool), L.settingsButtonVisible(true, null)], [true, false, false, false, false, false, false]);
check("G11 the real tab layout still works with Reports in the list", L.layoutTabs(L.visibleTools(REG, [], true), "reports", 340).visible.length === 3);

// ================= H. Job Watch alerts =================
for (const [minutes, text] of [[0, "0m"], [1, "1m"], [59, "59m"], [60, "1h"], [61, "1h 1m"], [90, "1h 30m"], [100, "1h 40m"], [119, "1h 59m"], [120, "2h"], [1440, "24h"], [-5, "0m"], [NaN, "0m"], [undefined, "0m"], ["45", "45m"], [59.6, "1h"], [null, "0m"]]) eq(`H1 formatDuration(${minutes}) is ${text}`, L.formatDuration(minutes), text);
eq("H2 names: none, blank, one, two, three, four", [L.joinNames([]), L.joinNames([""]), L.joinNames(["Alex"]), L.joinNames(["Alex", "Blake"]), L.joinNames(["Alex", "Blake", "Casey"]), L.joinNames(["A", "B", "C", "D"])], ["A technician", "A technician", "Alex", "Alex and Blake", "Alex, Blake and Casey", "A, B, C and D"]);
eq("H3 names: missing list", [L.joinNames(undefined), L.joinNames(null)], ["A technician", "A technician"]);
const NOWMS = Date.parse("2026-10-12T19:00:00Z");
const al = (o = {}) => ({ id: "job_1@90", techs: ["Alex Tech"], label: "Install #77", minutesOnJob: 100, limitMinutes: 90, startedAt: new Date(NOWMS - 100 * 60000).toISOString(), startedLabel: "12:20 PM", ...o });
let m = L.alertMessage(al(), NOWMS);
eq("H4 the alert sentence: who, what, how long", m.title, 'Alex Tech has been on "Install #77" for 1h 40m');
eq("H5 the second line: the normal limit, when it started, how to clear it", m.detail, "Longer than the normal 1h 30m. Started 12:20 PM. Click to dismiss.");
eq("H6 two techs: 'have'", L.alertMessage(al({ techs: ["Alex Tech", "Blake Tech"] }), NOWMS).title, 'Alex Tech and Blake Tech have been on "Install #77" for 1h 40m');
eq("H7 the time keeps counting between checks (started 105 min ago, last check said 100)", L.alertMessage(al({ startedAt: new Date(NOWMS - 105 * 60000).toISOString() }), NOWMS).title.endsWith("for 1h 45m"), true);
eq("H8 a clock that disagrees never makes it SHORTER than what the server reported", L.alertMessage(al({ startedAt: new Date(NOWMS - 10 * 60000).toISOString() }), NOWMS).title.endsWith("for 1h 40m"), true);
eq("H9 an unreadable start time falls back to the server's minutes", L.alertMessage(al({ startedAt: "nonsense" }), NOWMS).title.endsWith("for 1h 40m"), true);
eq("H10 no start label says 'earlier'", L.alertMessage(al({ startedLabel: undefined }), NOWMS).detail.includes("Started earlier."), true);
eq("H11 nobody named: 'A technician has'", L.alertMessage(al({ techs: [] }), NOWMS).title.startsWith('A technician has been on'), true);
eq("H12 a one-hour limit reads '1h', not '60m'", L.alertMessage(al({ limitMinutes: 60 }), NOWMS).detail.startsWith("Longer than the normal 1h."), true);
const list = [al({ id: "a@90" }), al({ id: "b@60" }), al({ id: "c@90" })];
eq("H13 dismissed alerts are removed, the rest kept in order", L.undismissedAlerts(list, { "b@60": 1 }).map((x) => x.id), ["a@90", "c@90"]);
eq("H14 nothing dismissed, or junk for the dismissed list: all shown", [L.undismissedAlerts(list, {}).length, L.undismissedAlerts(list, null).length, L.undismissedAlerts(list, "x").length, L.undismissedAlerts(list, undefined).length], [3, 3, 3, 3]);
eq("H15 alerts with no usable id are dropped; null lists are fine", [L.undismissedAlerts([{ label: "x" }, null, { id: 5 }], {}).length, L.undismissedAlerts(null, {}).length], [0, 0]);
eq("H16 an id like 'constructor' or '__proto__' is not mistaken for a dismissal", L.undismissedAlerts([al({ id: "constructor" }), al({ id: "__proto__" }), al({ id: "toString" })], {}).length, 3);
const HOUR = 3600000;
eq("H17 recent dismissals are kept, day-old ones forgotten", L.pruneDismissed({ fresh: NOWMS - HOUR, edge: NOWMS - 24 * HOUR + 1000, old: NOWMS - 24 * HOUR, ancient: NOWMS - 90 * HOUR }, NOWMS), { fresh: NOWMS - HOUR, edge: NOWMS - 24 * HOUR + 1000 });
eq("H18 junk entries are dropped (non-numbers, empty or over-long ids, times far in the future)", L.pruneDismissed({ ok: NOWMS, text: "yesterday", nan: NaN, nul: null, "": NOWMS, ["x".repeat(121)]: NOWMS, future: NOWMS + HOUR }, NOWMS), { ok: NOWMS });
const many = {}; for (let i = 0; i < 500; i++) many["id" + i] = NOWMS - i * 1000;
const kept = L.pruneDismissed(many, NOWMS);
eq("H19 the list is capped at 200 and keeps the NEWEST", [Object.keys(kept).length, "id0" in kept, "id199" in kept, "id200" in kept], [200, true, true, false]);
eq("H20 junk input gives an empty list", [L.pruneDismissed(null, NOWMS), L.pruneDismissed("x", NOWMS), L.pruneDismissed([1, 2], NOWMS), L.pruneDismissed(undefined, NOWMS)], [{}, {}, {}, {}]);
const frozen = Object.freeze({ a: NOWMS }); L.pruneDismissed(frozen, NOWMS); check("H21 the input is never modified", frozen.a === NOWMS);
let st = L.normalizeSettings({ version: 2, jobWatchDismissed: { "j@90": NOWMS - HOUR, "old@90": NOWMS - 30 * HOUR } }, ["dispatch"], NOWMS);
eq("H22 saved dismissals load, old ones are dropped on load", st.jobWatchDismissed, { "j@90": NOWMS - HOUR });
eq("H23 junk for dismissals in the file gives none", [L.normalizeSettings({ version: 2, jobWatchDismissed: [1, 2] }, ["dispatch"], NOWMS).jobWatchDismissed, L.normalizeSettings({ version: 2, jobWatchDismissed: "x" }, ["dispatch"], NOWMS).jobWatchDismissed], [{}, {}]);
eq("H24 the old settings format and an empty file have none", [L.normalizeSettings({ dispatch: "http://localhost:3000" }, ["dispatch"], NOWMS).jobWatchDismissed, L.normalizeSettings(undefined, ["dispatch"], NOWMS).jobWatchDismissed], [{}, {}]);

// ---- cleanAlerts: whatever the server sends becomes well-formed alerts or nothing
const good = { id: "job_1@90", kind: "install", label: "Install #77", techs: ["Alex Tech"], startedAt: "2026-10-12T17:20:00.000Z", startedLabel: "12:20 PM", minutesOnJob: 100, limitMinutes: 90 };
eq("H25 a good alert passes through unchanged", L.cleanAlerts([good]), [good]);
eq("H26 junk lists give nothing", [L.cleanAlerts(null), L.cleanAlerts("x"), L.cleanAlerts({}), L.cleanAlerts(undefined), L.cleanAlerts(5)], [[], [], [], [], []]);
eq("H27 entries without a usable id are dropped (missing, empty, number, too long, null, a string)", L.cleanAlerts([{ ...good, id: undefined }, { ...good, id: "" }, { ...good, id: 7 }, { ...good, id: "x".repeat(121) }, null, "alert"]), []);
eq("H28 an unknown kind becomes 'service'; a missing label becomes 'Job'", [L.cleanAlerts([{ ...good, kind: "weird" }])[0].kind, L.cleanAlerts([{ ...good, label: undefined }])[0].label], ["service", "Job"]);
eq("H29 long text is cut (label 60, tech names 60, start label 12)", [L.cleanAlerts([{ ...good, label: "L".repeat(200) }])[0].label.length, L.cleanAlerts([{ ...good, techs: ["T".repeat(200)] }])[0].techs[0].length, L.cleanAlerts([{ ...good, startedLabel: "9".repeat(50) }])[0].startedLabel.length], [60, 60, 12]);
eq("H30 techs: only non-blank text, at most six; a non-list becomes none", [L.cleanAlerts([{ ...good, techs: ["A", "", "  ", 5, null, "B", "C", "D", "E", "F", "G"] }])[0].techs, L.cleanAlerts([{ ...good, techs: "Alex" }])[0].techs], [["A", "B", "C", "D", "E", "F"], []]);
eq("H31 numbers that are not numbers become 0", L.cleanAlerts([{ ...good, minutesOnJob: "lots", limitMinutes: null }]).map((a) => [a.minutesOnJob, a.limitMinutes])[0], [0, 0]);
eq("H32 at most 30 alerts are taken", L.cleanAlerts(Array.from({ length: 100 }, (_, i) => ({ ...good, id: "j" + i }))).length, 30);
eq("H33 HTML in the text is left as plain text (the panel only ever shows it as text)", L.cleanAlerts([{ ...good, label: "<img src=x onerror=alert(1)>" }])[0].label, "<img src=x onerror=alert(1)>");
eq("H34 extra fields (a customer name, say) are not carried along", Object.keys(L.cleanAlerts([{ ...good, customer: "Jane Customer", address: "12 Secret Ln" }])[0]).sort(), ["id", "kind", "label", "limitMinutes", "minutesOnJob", "startedAt", "startedLabel", "techs"]);

// ---- finished-job notifications
const doneGood = { id: "job_1#1760000000000", kind: "service", label: "Service call #4600", techs: ["Alex Tech"], completedAt: "2026-10-12T19:14:00.000Z", completedLabel: "2:14 PM", minutesOnJob: 65, notes: ["Replaced spring.", "Needs a quote for a new opener."], notesPending: false, notesHidden: false };
eq("H35 a good completion passes through unchanged", L.cleanCompletions([doneGood]), [doneGood]);
eq("H36 junk lists give nothing", [L.cleanCompletions(null), L.cleanCompletions("x"), L.cleanCompletions({}), L.cleanCompletions(undefined), L.cleanCompletions(5)], [[], [], [], [], []]);
eq("H37 entries without a usable id are dropped", L.cleanCompletions([{ ...doneGood, id: undefined }, { ...doneGood, id: "" }, { ...doneGood, id: 7 }, { ...doneGood, id: "x".repeat(121) }, null, "done"]), []);
eq("H38 an unknown time on the job stays 'unknown' (null), a bad one too, and a negative one becomes 0", [L.cleanCompletions([{ ...doneGood, minutesOnJob: null }])[0].minutesOnJob, L.cleanCompletions([{ ...doneGood, minutesOnJob: "lots" }])[0].minutesOnJob, L.cleanCompletions([{ ...doneGood, minutesOnJob: -4 }])[0].minutesOnJob, L.cleanCompletions([{ ...doneGood, minutesOnJob: undefined }])[0].minutesOnJob], [null, null, 0, null]);
eq("H39 notes: only non-blank text, the last three, each cut to 320 characters; a non-list becomes none", [L.cleanCompletions([{ ...doneGood, notes: ["a", "", "  ", 5, null, "b", "c", "d", "e"] }])[0].notes, L.cleanCompletions([{ ...doneGood, notes: "just text" }])[0].notes, L.cleanCompletions([{ ...doneGood, notes: ["n".repeat(900)] }])[0].notes[0].length], [["c", "d", "e"], [], 320]);
eq("H40 flags are only true when exactly true; an unknown kind is service; a missing label is 'Job'", [L.cleanCompletions([{ ...doneGood, notesPending: "yes", notesHidden: 1 }])[0].notesPending, L.cleanCompletions([{ ...doneGood, notesPending: "yes", notesHidden: 1 }])[0].notesHidden, L.cleanCompletions([{ ...doneGood, kind: "odd" }])[0].kind, L.cleanCompletions([{ ...doneGood, label: undefined }])[0].label], [false, false, "service", "Job"]);
eq("H41 at most 20 are taken, and extra fields (a customer name, say) are not carried along", [L.cleanCompletions(Array.from({ length: 80 }, (_, i) => ({ ...doneGood, id: "j" + i }))).length, Object.keys(L.cleanCompletions([{ ...doneGood, customer: "Jane", address: "12 Secret Ln" }])[0]).sort()], [20, ["completedAt", "completedLabel", "id", "kind", "label", "minutesOnJob", "notes", "notesHidden", "notesPending", "techs"]]);
eq("H42 HTML in a note stays plain text", L.cleanCompletions([{ ...doneGood, notes: ["<img src=x onerror=alert(1)>"] }])[0].notes[0], "<img src=x onerror=alert(1)>");
let cm = L.completionMessage(doneGood);
eq("H43 the finished bar: title, the time and how long it took, and the notes on separate lines", [cm.title, cm.detail, cm.notes, cm.hasNotes], ['Alex Tech finished "Service call #4600"', "Finished 2:14 PM after 1h 5m.", "Replaced spring.\nNeeds a quote for a new opener.", true]);
eq("H44 two techs", L.completionMessage({ ...doneGood, techs: ["Alex Tech", "Blake Tech"] }).title, 'Alex Tech and Blake Tech finished "Service call #4600"');
eq("H45 no time taken (no Start tap): the sentence just says when it finished", L.completionMessage({ ...doneGood, minutesOnJob: null }).detail, "Finished 2:14 PM.");
eq("H46 no finish label says 'just now'", L.completionMessage({ ...doneGood, completedLabel: "", minutesOnJob: null }).detail, "Finished just now.");
eq("H47 no notes and not pending: 'No notes were left.'", [L.completionMessage({ ...doneGood, notes: [] }).notes, L.completionMessage({ ...doneGood, notes: [] }).hasNotes], ["No notes were left.", false]);
eq("H48 no notes yet but fresh: says they may still appear", L.completionMessage({ ...doneGood, notes: [], notesPending: true }).notes, "No notes yet. They will appear here if the tech adds them.");
eq("H49 notes switched off: says so (even if notes were somehow sent)", [L.completionMessage({ ...doneGood, notesHidden: true }).notes, L.completionMessage({ ...doneGood, notesHidden: true }).hasNotes], ["Notes are turned off.", false]);
eq("H50 dismissals work for finished jobs too (same list, ids with a #)", L.undismissedAlerts([doneGood, { ...doneGood, id: "job_2#9" }], { "job_1#1760000000000": 1 }).map((x) => x.id), ["job_2#9"]);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
