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
eq("F1 nothing saved: complete defaults", s, { version: 2, serverUrl: "http://localhost:3000", toolUrls: {}, hiddenTools: [], lastTool: null, window: { width: 380, displayId: null } });
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

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
