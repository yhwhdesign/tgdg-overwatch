const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");
const path = require("path");
let passes = 0, failures = 0;
const check = (name, ok, detail = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${name}${detail ? "  <- " + detail : ""}`); } };
(async () => {
  const out = await esbuild.build({ entryPoints: [path.join(__dirname, "../../src/app/weekend/page.tsx")], bundle: true, write: false, format: "cjs", platform: "node", jsx: "automatic", alias: { "@": path.join(__dirname, "../../src") }, nodePaths: [path.join(__dirname, "../../node_modules")], external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom"], logLevel: "silent" });
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost:3000/weekend", pretendToBeVisual: true });
  const { window } = dom;
  Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement, Event: window.Event, StorageEvent: window.StorageEvent });
  Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require("react"); const { createRoot } = require("react-dom/client"); const { act } = React;
  const mod = { exports: {} }; new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  const Page = mod.exports.default;

  const WORDS = ["part", "parts", "order", "need", "needs", "call back", "quote"];
  const item = (id, over = {}) => ({ id, kind: "service", label: `Repair #${id.slice(-4)}`, techs: ["Josh Bayliss"], state: "finished", whenLabel: "Sat 11:00 AM", whenAt: "2026-10-17T16:00:00.000Z", minutesOnJob: 50, notes: ["job complete"], words: [], reasons: [], needsLook: false, url: `https://pro.housecallpro.com/app/jobs/${id}`, ...over });
  const items = [
    item("job_noNotes", { label: "Repair #40892", notes: [], reasons: ["no-notes"], needsLook: true }),
    item("job_unfinished", { label: "Repair #40300", state: "not-started", notes: [], reasons: ["unfinished"], needsLook: true, minutesOnJob: null, whenLabel: "Sun 9:00 AM" }),
    item("job_words", { label: "Repair #40883", notes: ["Replaced spring. Needs a quote for a new opener.", "will <b>order</b> part <img src=x onerror=alert(1)>"], words: ["part", "order", "needs", "quote"], reasons: ["words"], needsLook: true }),
    item("job_clean", { label: "Install #40400", kind: "install", notes: ["All set, door tested"], whenLabel: "Sun 2:50 PM" }),
  ];
  const recap = (over = {}) => ({ ok: true, checkedAt: "2026-10-19T14:00:00.000Z", window: { start: "2026-10-16T23:00:00.000Z", end: "2026-10-19T03:00:00.000Z", label: "Fri, Oct 16, 6 PM to Sun, Oct 18, 10 PM", isCurrent: false, back: 0 }, notesHidden: false, words: WORDS, counts: { total: 4, finished: 3, needsLook: 3, withWords: 1, noNotes: 1, unfinished: 1 }, items, ...over });
  const calls = []; let answer;
  const respond = (status, body, extra = {}) => ({ ok: status >= 200 && status < 300, status, redirected: false, json: async () => { if (body === undefined) throw new Error("not json"); return body; }, ...extra });
  globalThis.fetch = async (url) => { calls.push(String(url)); if (String(url) === "/api/job-watch") return respond(503, {}); return answer(String(url)); };
  const root = createRoot(document.getElementById("root"));
  const settle = async (ms = 15) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
  const mount = async () => { calls.length = 0; await act(async () => { root.render(React.createElement(React.Fragment, { key: Math.random() }, React.createElement(Page))); }); await settle(); };
  const click = async (el) => { await act(async () => { el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); }); await settle(); };
  const cards = () => [...document.querySelectorAll("[data-item]")];
  const card = (id) => document.querySelector(`[data-item="${id}"]`);
  const text = (el = document.body) => el.textContent.replace(/\s+/g, " ").trim();
  const recapCalls = () => calls.filter((c) => c.startsWith("/api/weekend-recap"));
  const btn = (sel) => document.querySelector(sel);

  answer = () => respond(200, recap());
  window.localStorage.clear();
  await mount();
  check("A1 it asks for this weekend once", recapCalls().length === 1 && recapCalls()[0] === "/api/weekend-recap?back=0", JSON.stringify(calls));
  check("A2 the window is named in the header", /Fri, Oct 16, 6 PM to Sun, Oct 18, 10 PM/.test(document.querySelector('[data-field="window"]').textContent) && !/going on now/.test(text()));
  check("A3 the summary counts jobs and what needs a look and what has no notes", /4 jobs · 3 need a look · 1 with no notes/.test(document.querySelector('[data-field="summary"]').textContent), document.querySelector('[data-field="summary"]').textContent);
  check("A4 by default only the jobs that need a look are shown, in the server's order", cards().map((c) => c.dataset.item).join() === "job_noNotes,job_unfinished,job_words", cards().map((c) => c.dataset.item).join());
  check("A5 the two filter tabs show their counts, the first is selected", btn('[data-filter="look"]').textContent === "Needs a look (3)" && btn('[data-filter="all"]').textContent === "Everything (4)" && btn('[data-filter="look"]').getAttribute("aria-selected") === "true");
  const w = card("job_words");
  check("A6 each card says which job, who, and how it ended", w.querySelector('[data-field="label"]').textContent === "Repair #40883" && w.querySelector('[data-field="techs"]').textContent === "Josh Bayliss" && /Finished Sat 11:00 AM after 50m/.test(w.querySelector('[data-field="state"]').textContent), text(w));
  check("A7 a flagged-words job has the amber chip naming the words", /May need follow-up: part, order, needs, quote/.test(w.querySelector('[data-reason="words"]').textContent));
  check("A8 the flagged words are highlighted inside the notes", [...w.querySelectorAll("mark[data-hit]")].map((m) => m.textContent.toLowerCase()).join() === "needs,quote,order,part", [...w.querySelectorAll("mark")].map((m) => m.textContent).join());
  check("A9 all the notes are shown in full", /Replaced spring\. Needs a quote for a new opener\./.test(text(w.querySelector('[data-field="notes"]'))));
  check("A10 text in a note is shown as text: no tag from a note becomes part of the page", !w.querySelector("img") && !w.querySelector("b") && /<b>order<\/b>/.test(w.querySelector('[data-field="notes"]').textContent));
  check("A11 'No notes left' and 'Not finished' chips", !!card("job_noNotes").querySelector('[data-reason="no-notes"]') && !!card("job_unfinished").querySelector('[data-reason="unfinished"]') && /Scheduled Sun 9:00 AM, never started/.test(text(card("job_unfinished"))));
  const go = w.querySelector('[data-action="go"]');
  check("A12 no Go to job link (the HCP phone app can't open it)", !go && !w.querySelector('a[href*="housecallpro"]'));
  await click(btn('[data-filter="all"]'));
  check("A13 Everything shows all four, the clean job last and not flagged", cards().length === 4 && cards()[3].dataset.item === "job_clean" && !cards()[3].querySelector("[data-reason]") && cards()[3].dataset.needsLook === "false");
  check("A14 the how-it-works note lists the words and says marks are saved in this browser", /How jobs are flagged/.test(text()) && /part, parts, order/.test(text(document.querySelector("details"))) && /this browser only/.test(text(document.querySelector("details"))));

  // ---- reviewed
  await click(btn('[data-filter="look"]'));
  await click(card("job_noNotes").querySelector('[data-action="review"]'));
  check("B1 marking a job reviewed dims it, moves it to the bottom, and lowers the 'need a look' count", card("job_noNotes").dataset.reviewed === "true" && cards()[cards().length - 1].dataset.item === "job_noNotes" && /2 need a look/.test(document.querySelector('[data-field="summary"]').textContent), cards().map((c) => c.dataset.item + c.dataset.reviewed).join());
  const saved = JSON.parse(window.localStorage.getItem("overwatch.recap.reviewed") || "{}");
  check("B2 it is remembered in the browser, per weekend", Object.keys(saved).join() === "2026-10-16T23:00:00.000Z|job_noNotes", JSON.stringify(saved));
  await mount();
  check("B3 after a reload it is still reviewed", card("job_noNotes").dataset.reviewed === "true" && /2 need a look/.test(document.querySelector('[data-field="summary"]').textContent));
  await click(card("job_noNotes").querySelector('[data-action="review"]'));
  check("B4 Undo brings it back (and forgets it)", card("job_noNotes").dataset.reviewed === "false" && Object.keys(JSON.parse(window.localStorage.getItem("overwatch.recap.reviewed"))).length === 0 && /3 need a look/.test(document.querySelector('[data-field="summary"]').textContent));
  window.localStorage.setItem("overwatch.recap.reviewed", JSON.stringify({ "2026-10-16T23:00:00.000Z|job_words": Date.now() - 100 * 86400000, "x|y": "bad" }));
  await mount();
  check("B5 a mark older than 90 days, or junk, is forgotten", card("job_words").dataset.reviewed === "false");
  window.localStorage.setItem("overwatch.recap.reviewed", "{nope");
  await mount();
  check("B6 unreadable saved marks are ignored and the page works", cards().length === 3);
  window.localStorage.clear();
  const realSet = window.localStorage.setItem.bind(window.localStorage);
  Object.defineProperty(window, "localStorage", { value: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } }, configurable: true });
  await mount();
  await click(card("job_words").querySelector('[data-action="review"]'));
  check("B7 with browser storage blocked, marking still works for this page", card("job_words").dataset.reviewed === "true");
  Object.defineProperty(window, "localStorage", { value: dom.window.Storage ? new (class { constructor() { this.m = {}; } getItem(k) { return k in this.m ? this.m[k] : null; } setItem(k, v) { this.m[k] = String(v); } removeItem(k) { delete this.m[k]; } clear() { this.m = {}; } })() : null, configurable: true });

  // ---- moving between weekends
  answer = (url) => respond(200, recap(url.includes("back=1") ? { window: { start: "2026-10-09T23:00:00.000Z", end: "2026-10-12T03:00:00.000Z", label: "Fri, Oct 9, 6 PM to Sun, Oct 11, 10 PM", isCurrent: false, back: 1 }, items: [item("job_words", { label: "Repair #1", notes: ["need part"], words: ["need", "part"], reasons: ["words"], needsLook: true })], counts: { total: 1, finished: 1, needsLook: 1, withWords: 1, noNotes: 0, unfinished: 0 } } : {}));
  await mount();
  check("C1 'Later weekend' is off on the latest weekend", btn('[data-action="later"]').disabled === true && btn('[data-action="earlier"]').disabled === false);
  await click(btn('[data-action="earlier"]'));
  check("C2 'Earlier weekend' asks for back=1 and shows that weekend", recapCalls().pop() === "/api/weekend-recap?back=1" && /Fri, Oct 9, 6 PM/.test(document.querySelector('[data-field="window"]').textContent) && btn('[data-action="later"]').disabled === false);
  check("C3 the same job id on another weekend is not marked reviewed from the first (marks are per weekend)", card("job_words").dataset.reviewed === "false");
  await click(btn('[data-action="later"]'));
  check("C4 'Later weekend' goes back to this one", recapCalls().pop() === "/api/weekend-recap?back=0");
  await click(btn('[data-action="refresh"]'));
  check("C5 Refresh skips the server's cache", recapCalls().pop() === "/api/weekend-recap?back=0&fresh=1");

  // ---- the quiet and the broken
  answer = () => respond(200, recap({ items: [], counts: { total: 0, finished: 0, needsLook: 0, withWords: 0, noNotes: 0, unfinished: 0 } }));
  await mount();
  check("D1 a weekend with no jobs says so, with no tabs", /No jobs were worked this weekend\./.test(text()) && !btn("[data-filter]"));
  answer = () => respond(200, recap({ items: [items[3]], counts: { total: 1, finished: 1, needsLook: 0, withWords: 0, noNotes: 0, unfinished: 0 } }));
  await mount();
  check("D2 nothing needs a look: it says so and offers Everything", !!document.querySelector('[data-state="nothing-to-look"]') && cards().length === 0 && /1 job · 0 need a look/.test(document.querySelector('[data-field="summary"]').textContent));
  await click(btn('[data-filter="all"]'));
  check("D3 ...and Everything shows the one job", cards().length === 1);
  answer = () => respond(200, recap({ notesHidden: true, items: items.map((i) => ({ ...i, notes: [], words: [], reasons: [] })) }));
  await mount(); await click(btn('[data-filter="all"]'));
  check("D4 with notes turned off each card says so", cards().length === 4 && cards().every((c) => /Notes are turned off\./.test(c.textContent)));
  answer = () => respond(200, { ok: false, checkedAt: "x", error: "Could not check: Housecall Pro is having a problem on its side." });
  await mount();
  check("D5 the server's plain message is shown with Try again", /having a problem on its side/.test(document.querySelector('[data-state="error"]').textContent) && !!btn('[data-action="retry"]'));
  answer = () => { throw new Error("offline"); };
  await mount();
  check("D6 a network failure is shown, not a blank page", !!document.querySelector('[data-state="error"]') && /offline/.test(document.querySelector('[data-state="error"]').textContent));
  answer = () => respond(401, {});
  await mount();
  check("D7 401 says to sign in again", /Sign in again/.test(document.querySelector('[data-state="error"]').textContent));
  answer = () => respond(200, undefined, { redirected: true });
  await mount();
  check("D8 being bounced to the sign-in page also says to sign in again", /Sign in again/.test(document.querySelector('[data-state="error"]').textContent));
  answer = () => respond(500, {});
  await mount();
  check("D9 HTTP 500 is named", /HTTP 500/.test(document.querySelector('[data-state="error"]').textContent));
  answer = () => respond(200, "<html>surprise</html>");
  await mount();
  check("D10 a surprise answer is an error message, never a crash", !!document.querySelector('[data-state="error"]'));
  answer = () => respond(200, { ok: true, items: "nope" });
  await mount();
  check("D11 a malformed answer is an error message too", !!document.querySelector('[data-state="error"]'));
  let calls2 = 0; answer = () => (++calls2 === 1 ? respond(500, {}) : respond(200, recap()));
  await mount(); await click(btn('[data-action="retry"]'));
  check("D12 Try again recovers", cards().length === 3 && !document.querySelector('[data-state="error"]'));
  answer = () => respond(200, recap({ window: { ...recap().window, isCurrent: true } }));
  await mount();
  check("D13 a weekend that is still going on says so", /going on now/.test(document.querySelector('[data-field="window"]').textContent));
  answer = () => new Promise(() => {});
  await mount();
  check("D14 while it is reading it says so", !!document.querySelector('[data-state="loading"]'));

  // ---- the links row between pages
  answer = () => respond(200, recap());
  await mount();
  const nav = document.querySelector("[data-site-nav]");
  check("E1 the page links row: Dispatch, Estimates, Weekend recap, with this page marked", nav && [...nav.querySelectorAll("a")].map((a) => a.getAttribute("href")).join() === "/,/estimates,/weekend" && nav.querySelector('a[aria-current="page"]').textContent === "Weekend recap");
  Object.defineProperty(window.navigator, "userAgent", { value: "Mozilla/5.0 Electron/30 Overwatch", configurable: true });
  await mount();
  check("E2 inside the desktop panel (which has its own tabs) the row is not drawn", !document.querySelector("[data-site-nav]"));

  console.log(`${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log("CRASH", e); process.exit(1); });
