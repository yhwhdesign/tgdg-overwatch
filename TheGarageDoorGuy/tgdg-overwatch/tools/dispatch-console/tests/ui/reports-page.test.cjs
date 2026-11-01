// The Reports page against a fake server: sign-in, ranges, every section, and that it never links into Housecall Pro.
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");
const path = require("path");
let passes = 0, failures = 0;
const check = (name, ok, detail = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${name}${detail ? "  <- " + detail : ""}`); } };
(async () => {
  const out = await esbuild.build({ entryPoints: [path.join(__dirname, "../../src/app/reports/page.tsx")], bundle: true, write: false, format: "cjs", platform: "node", jsx: "automatic", alias: { "@": path.join(__dirname, "../../src") }, nodePaths: [path.join(__dirname, "../../node_modules")], external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom"], logLevel: "silent" });
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost:3000/reports", pretendToBeVisual: true });
  const { window } = dom;
  Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement, Event: window.Event, MouseEvent: window.MouseEvent });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require("react"); const { createRoot } = require("react-dom/client"); const { act } = React;
  const mod = { exports: {} }; new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  const Page = mod.exports.default;

  const tiles = (o = {}) => ({ revenueCents: 1250000, jobs: 50, avgTicketCents: 25000, revenuePerTechDayCents: 150000, closeRatePct: 55, goBackRatePct: 4, outstandingCents: 30000, afterHoursPct: 8, ...o });
  const tech = (o) => ({ id: "A", name: "Alex Tech", jobs: 20, installs: 4, service: 16, smallSample: false, revenueCents: 600000, avgTicketCents: 30000, techDays: 10, revenuePerDayCents: 60000, jobsPerDay: 2, onJobHours: 30, revenuePerHourCents: 20000, medianInstallMinutes: 150, medianServiceMinutes: 40, utilizationPct: 55, driveMinutes: 400, drivePerJobMinutes: 20, driveSharePct: 18, miles: 210, milesPerJob: 10.5, onTimePct: 90, lateStarts: 2, itemsPerJob: 2.4, addOnRatePct: 60, repairAvgTicketCents: 28000, goBacks: 1, goBackRatePct: 5, estimates: 8, estimatesWon: 5, closeRatePct: 62.5, estimateWonCents: 900000, estimatePresentedCents: 1500000, avgOptions: 2.5, outstandingCents: 20000, ranks: { revenueCents: "top", revenuePerHourCents: "top", drivePerJobMinutes: "bottom" }, ...o });
  const REPORT = {
    range: { from: "2026-10-03", to: "2026-11-01", label: "Last 30 days", previousLabel: "the 30 days before" },
    tiles: tiles(), previous: tiles({ revenueCents: 1000000, goBackRatePct: 2 }),
    trend: [{ key: "2026-10-05", label: "Week of Oct 5", revenueCents: 300000, jobs: 12, avgTicketCents: 25000 }],
    trendBy: "week",
    mix: { byKind: [{ key: "Installs", jobs: 8, revenueCents: 800000 }], byBusinessUnit: [{ key: "Residential", jobs: 40, revenueCents: 1000000 }], byJobType: [{ key: "Repair", jobs: 42, revenueCents: 450000 }], afterHours: { jobs: 4, revenueCents: 120000, avgTicketCents: 30000 } },
    techs: [tech({}), tech({ id: "B", name: "Blake Tech", revenueCents: 400000, revenuePerHourCents: 30000, ranks: { revenueCents: "bottom" } }), tech({ id: "D", name: "Dana Tech", jobs: 3, smallSample: true, revenuePerHourCents: null, ranks: {} }), tech({ id: "E", name: "Eve Estimator", jobs: 0, estimates: 4, estimateWonCents: 100000, ranks: {} })],
    medians: {},
    products: [{ name: "Torsion Spring 207", jobs: 9, quantity: 14, revenueCents: 210000 }],
    productMatrix: { products: ["Torsion Spring 207"], rows: [{ tech: "Alex Tech", counts: [6] }, { tech: "Blake Tech", counts: [0] }] },
    goBacks: [{ number: "5012", firstNumber: "4990", techs: ["Alex Tech"], days: 6, date: "2026-10-20" }],
    lateStarts: [{ number: "5001", tech: "Blake Tech", minutesLate: 75, date: "2026-10-12" }],
    byZip: [{ zip: "72201", jobs: 10, revenueCents: 300000 }],
    dataNotes: ["Only 80% of jobs have a map point, so miles are low estimates."],
  };
  let status = 200; const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return status === 200 ? { ok: true, status: 200, json: async () => ({ ok: true, report: REPORT }) } : status === 502 ? { ok: false, status: 502, json: async () => ({ ok: false, error: "Could not read Housecall Pro: the network failed." }) } : { ok: false, status, json: async () => ({ error: "Not signed in." }) }; };
  const root = createRoot(document.getElementById("root"));
  const text = () => document.body.textContent.replace(/\s+/g, " ").trim();
  const q = (s) => [...document.querySelectorAll(s)];
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  const mount = async () => { await act(async () => { root.render(React.createElement(React.Fragment, { key: Math.random() }, React.createElement(Page))); }); await settle(); };
  const click = async (el) => { await act(async () => { el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); }); await settle(); };

  status = 401; await mount();
  check("R1 not signed in as admin: says so, shows no numbers", !!document.querySelector('[data-state="signedOut"]') && !document.querySelector('[data-section="tiles"]'));
  status = 502; await mount();
  check("R2 Housecall Pro unreachable: says so plainly", text().includes("Could not read Housecall Pro"));
  status = 200; calls.length = 0; await mount();
  check("R3 opens on the last 30 days", calls[0] === "/api/admin/reports?range=30", calls[0]);
  check("R4 tiles with change vs the previous period (arrow + text)", document.querySelector('[data-tile="Revenue"]').textContent.includes("$12,500") && document.querySelector('[data-tile="Revenue"] [data-field="delta"]').textContent.includes("▲ +25%"));
  const goBackDelta = document.querySelector('[data-tile="Go-back rate"] [data-field="delta"]');
  check("R5 a rise in go-backs is shown as bad (lower is better)", goBackDelta.textContent.includes("▲") && goBackDelta.className.includes("text-red-800"));
  check("R6 data notes are shown", text().includes("Only 80% of jobs have a map point"));
  ["scorecard", "money", "sales", "efficiency", "driving", "products", "gobacks", "estimates", "owed", "trend", "mix"].forEach((s) => check(`R7 section ${s} is there`, !!document.querySelector(`[data-section="${s}"]`)));
  const alexRow = document.querySelector('[data-tech="Alex Tech"]');
  check("R8 ranks show as arrows, not color alone", alexRow.querySelector('[data-rank="top"]').textContent.startsWith("▲") && alexRow.querySelector('[data-rank="bottom"]').textContent.startsWith("▼"));
  check("R9 small samples are labeled; techs with no jobs stay off the scorecard", text().includes("Dana Tech(small sample)") && !document.querySelector('[data-tech="Eve Estimator"]'));
  check("R10 ...but an estimator still shows in the estimates table", document.querySelector('[data-section="estimates"]').textContent.includes("Eve Estimator"));
  const money = q('[data-section="money"] [data-bar]').map((b) => b.getAttribute("data-bar"));
  check("R11 'most money' bars sorted by revenue per hour", JSON.stringify(money.slice(0, 2)) === JSON.stringify(["Blake Tech", "Alex Tech"]), JSON.stringify(money));
  check("R12 every bar has a hover description", q("[data-bar]").every((b) => (b.getAttribute("title") || "").includes(":")));
  check("R13 go-backs and late starts name job numbers to look up", text().includes("Job #5012 on Oct 20 went back to job #4990") && text().includes("Job #5001"));
  check("R14 never links into Housecall Pro", q('a[href*="housecallpro"]').length === 0);
  calls.length = 0;
  await click(document.querySelector('[data-range="ytd"]'));
  check("R15 picking This year asks for ytd", calls.includes("/api/admin/reports?range=ytd"), JSON.stringify(calls));
  calls.length = 0;
  await click(document.querySelector('[data-action="refresh"]'));
  check("R16 Refresh skips the cache", calls.includes("/api/admin/reports?range=ytd&fresh=1"), JSON.stringify(calls));

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(2); });
