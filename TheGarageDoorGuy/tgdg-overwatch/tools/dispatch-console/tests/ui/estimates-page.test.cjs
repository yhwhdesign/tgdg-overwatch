const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");
const path = require("path");
let passes = 0, failures = 0;
const check = (name, ok, detail = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${name}${detail ? "  <- " + detail : ""}`); } };
(async () => {
  const out = await esbuild.build({ entryPoints: [path.join(__dirname, "../../src/app/estimates/page.tsx")], bundle: true, write: false, format: "cjs", platform: "node", jsx: "automatic", alias: { "@": path.join(__dirname, "../../src") }, nodePaths: [path.join(__dirname, "../../node_modules")], external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom"], logLevel: "silent" });
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost:3000/estimates", pretendToBeVisual: true });
  const { window } = dom;
  Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement, Event: window.Event });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require("react"); const { createRoot } = require("react-dom/client"); const { act } = React;
  const mod = { exports: {} }; new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  const Page = mod.exports.default;
  let handler; const calls = [];
  globalThis.fetch = async (url) => { if (String(url) === "/api/job-watch") return { ok: false, status: 503, redirected: false, json: async () => ({}) }; /* the Job Watch bars on this page ask on their own; this suite is about estimates */ calls.push(String(url)); return handler(); };
  const root = createRoot(document.getElementById("root"));
  const text = () => document.body.textContent.replace(/\s+/g, " ").trim();
  const mount = async () => { calls.length = 0; await act(async () => { root.render(React.createElement(React.Fragment, { key: Math.random() }, React.createElement(Page))); }); await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };

  const tally = (o = {}) => ({ total: 0, won: 0, declined: 0, expired: 0, open: 0, canceled: 0, closeRate: null, wonCents: 0, ...o });
  const row = (o = {}) => ({ id: "csr_1", number: "8801", createdLabel: "Oct 16", techs: ["Alex Tech"], outcome: "open", amountCents: 125000, suspect: false, options: 1, customer: null, url: "https://pro.housecallpro.com/app/estimates/csr_1", ...o });
  const report = {
    from: "2026-01-01", to: "2026-10-19", listTags: ["Jasen Est", "*"],
    list: [row(), row({ id: "csr_2", number: "8802", outcome: "won", amountCents: 20000000, suspect: true, options: 2, url: null }), row({ id: "csr_3", number: "8803", outcome: "declined", customer: "Zelda Quimby" })],
    listTally: tally({ total: 3, open: 1, won: 1, declined: 1, closeRate: 33, wonCents: 20000000 }),
    byMonth: [{ key: "2026-10", tally: tally({ total: 5, won: 2, closeRate: 40, wonCents: 300000 }) }, { key: "2026-09", tally: tally({ total: 2, won: 0, closeRate: 0 }) }],
    byTech: [{ key: "Alex Tech", tally: tally({ total: 6, won: 2, closeRate: 33, wonCents: 300000 }) }],
    allTally: tally({ total: 7, won: 2, closeRate: 29, wonCents: 300000 }),
  };
  handler = () => ({ ok: true, status: 200, json: async () => ({ ok: true, checkedAt: "2026-10-19T15:00:00Z", report }) });
  await mount();
  check("E1 it asks the server for the estimates (and only that)", calls.length === 1 && calls[0] === "/api/estimates", JSON.stringify(calls));
  check("E2 ready: the title, the period and the list's tags", !!document.querySelector('[data-state="ready"]') && /Estimates/.test(text()) && /2026-01-01 to 2026-10-19/.test(text()) && /"Jasen Est" \+ "\*" list/.test(text()), text().slice(0, 200));
  const cards = () => [...document.querySelectorAll("[data-estimate]")];
  check("E3 three cards, each with number, date, tech, options and amount", cards().length === 3 && /Estimate #8801/.test(cards()[0].textContent) && /Oct 16/.test(cards()[0].textContent) && /Alex Tech/.test(cards()[0].textContent) && /1 option(?!s)/.test(cards()[0].textContent) && /\$1,250/.test(cards()[0].textContent), text());
  check("E4 a Go to estimate button on a card with a link, opening a new tab safely", (() => { const a = cards()[0].querySelector("a"); return !!a && a.textContent === "Go to estimate" && a.href === "https://pro.housecallpro.com/app/estimates/csr_1" && a.target === "_blank" && /noopener/.test(a.rel); })());
  check("E5 no button where there is no link", !cards()[1].querySelector("a"));
  check("E6 an enormous amount is marked to check, and shown in dollars not cents", /\$200,000/.test(cards()[1].textContent) && /check this amount/.test(cards()[1].textContent) && !/check this amount/.test(cards()[0].textContent));
  check("E7 the outcome badges read Waiting / Won / Declined", /Waiting/.test(cards()[0].textContent) && /Won/.test(cards()[1].textContent) && /Declined/.test(cards()[2].textContent));
  check("E8 customer names show only when the server sent them", !/Zelda/.test(cards()[0].textContent) && /Zelda Quimby/.test(cards()[2].textContent));
  check("E9 the list tiles: on the list, waiting, won with close rate, won dollars", /On the list3/.test(document.querySelector('[data-section="list-tiles"]').textContent) && /Waiting1/.test(document.querySelector('[data-section="list-tiles"]').textContent) && /33% close/.test(document.querySelector('[data-section="list-tiles"]').textContent) && /\$200,000/.test(document.querySelector('[data-section="list-tiles"]').textContent));
  check("E10 the year's numbers: made, close rate, won, won dollars", /Made7/.test(document.querySelector('[data-section="all-tiles"]').textContent) && /29%/.test(document.querySelector('[data-section="all-tiles"]').textContent) && /\$3,000/.test(document.querySelector('[data-section="all-tiles"]').textContent));
  check("E11 by month (named, newest first) and by tech", /Oct 2026/.test(text()) && text().indexOf("Oct 2026") < text().indexOf("Sep 2026") && /Alex Tech/.test(text()) && /By month/.test(text()) && /By tech/.test(text()));
  const click = async (sel) => { await act(async () => { document.querySelector(sel).dispatchEvent(new window.MouseEvent("click", { bubbles: true })); }); };
  await click('[data-filter="won"]');
  check("E12 the Won filter shows only won", cards().length === 1 && /8802/.test(cards()[0].textContent) && document.querySelector('[data-filter="won"]').getAttribute("aria-pressed") === "true");
  await click('[data-filter="expired"]');
  check("E13 a filter with nothing says so", cards().length === 0 && /Nothing in this view/.test(text()));
  await click('[data-filter="all"]');
  check("E14 All brings them back", cards().length === 3);
  calls.length = 0;
  const refresh = [...document.querySelectorAll("button")].find((b) => b.textContent === "Refresh");
  await act(async () => { refresh.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); }); await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  check("E15 Refresh asks for a fresh read", calls.length === 1 && calls[0] === "/api/estimates?fresh=1", JSON.stringify(calls));

  handler = () => ({ ok: true, status: 200, json: async () => ({ ok: true, checkedAt: "x", report: { ...report, list: [], listTally: tally() } }) });
  await mount();
  check("E16 an empty list says so plainly", /No estimates carry these tags in this period/.test(text()));
  handler = () => ({ ok: true, status: 200, json: async () => ({ ok: false, error: "Could not read estimates: Housecall Pro had a problem on its side." }) });
  await mount();
  check("E17 the server's plain message is shown, with Try again", !!document.querySelector('[data-state="error"]') && /problem on its side/.test(text()) && /Try again/.test(text()) && !document.querySelector('[data-estimate]'));
  handler = () => ({ ok: true, status: 200, json: async () => ({ ok: true, report: { weird: true } }) });
  await mount();
  check("E18 a strange answer shows an error, never a broken page", !!document.querySelector('[data-state="error"]') && /not what was expected/.test(text()));
  handler = () => { throw new Error("offline"); };
  await mount();
  check("E19 server unreachable: an error, and nothing else", !!document.querySelector('[data-state="error"]') && !document.querySelector('[data-state="ready"]'));
  handler = () => new Promise(() => {});
  await act(async () => { root.render(React.createElement(React.Fragment, { key: Math.random() }, React.createElement(Page))); });
  check("E20 while waiting it says Loading", !!document.querySelector('[data-state="loading"]') && /Loading/.test(text()));
  await act(async () => { root.unmount(); });
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(2); });
