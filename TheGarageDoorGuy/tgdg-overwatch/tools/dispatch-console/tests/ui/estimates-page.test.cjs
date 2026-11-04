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
  let handler; const calls = []; const reviewCalls = []; let reviewHandler = () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === "/api/job-watch") return { ok: false, status: 503, redirected: false, json: async () => ({}) };
    if (u.startsWith("/api/estimate-reviews")) { reviewCalls.push({ url: u, method: init.method || "GET", body: init.body ? JSON.parse(init.body) : undefined }); return reviewHandler(); }
    calls.push(u); return handler();
  };
  // capture CSV exports without needing a real object URL
  const exported = [];
  globalThis.URL.createObjectURL = (blob) => { exported.push(blob); return "blob:x"; };
  globalThis.URL.revokeObjectURL = () => {};
  const origOpen = window.open; window.open = () => null;
  const root = createRoot(document.getElementById("root"));
  const text = () => document.body.textContent.replace(/\s+/g, " ").trim();
  const mount = async () => { calls.length = 0; await act(async () => { root.render(React.createElement(React.Fragment, { key: Math.random() }, React.createElement(Page))); }); await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };

  const tally = (o = {}) => ({ total: 0, won: 0, declined: 0, expired: 0, open: 0, canceled: 0, closeRate: null, wonCents: 0, ...o });
  const row = (o = {}) => ({ id: "csr_1", number: "8801", createdLabel: "Oct 16", techs: ["Alex Tech"], outcome: "open", amountCents: 125000, suspect: false, options: 1, customer: null, url: null, fingerprint: "fp1", reviewed: false, reviewedBy: null, reviewedAt: null, reviewedAtLabel: null, note: null, changedSinceReview: false, needsReview: true, ...o });
  const report = {
    from: "2026-01-01", to: "2026-10-19", listTags: ["Jasen Est", "*"],
    list: [row(), row({ id: "csr_2", number: "8802", outcome: "won", amountCents: 20000000, suspect: true, options: 2, url: null }), row({ id: "csr_3", number: "8803", outcome: "declined", customer: "Zelda Quimby" })],
    listTally: tally({ total: 3, open: 1, won: 1, declined: 1, closeRate: 33, wonCents: 20000000 }),
    byMonth: [{ key: "2026-10", tally: tally({ total: 5, won: 2, closeRate: 40, wonCents: 300000 }) }, { key: "2026-09", tally: tally({ total: 2, won: 0, closeRate: 0 }) }],
    byTech: [{ key: "Alex Tech", tally: tally({ total: 6, won: 2, closeRate: 33, wonCents: 300000 }) }],
    allTally: tally({ total: 7, won: 2, closeRate: 29, wonCents: 300000 }),
    needsReviewCount: 3,
  };
  handler = () => ({ ok: true, status: 200, json: async () => ({ ok: true, checkedAt: "2026-10-19T15:00:00Z", report }) });
  await mount();
  check("E1 it asks the server for the estimates (and only that)", calls.length === 1 && calls[0] === "/api/estimates", JSON.stringify(calls));
  check("E2 ready: the title, the period and the list's tags", !!document.querySelector('[data-state="ready"]') && /Estimates/.test(text()) && /2026-01-01 to 2026-10-19/.test(text()) && /"Jasen Est" \+ "\*" list/.test(text()), text().slice(0, 200));
  const cards = () => [...document.querySelectorAll("[data-estimate]")];
  check("E3 three cards, each with number, date, tech, options and amount", cards().length === 3 && /Estimate #8801/.test(cards()[0].textContent) && /Oct 16/.test(cards()[0].textContent) && /Alex Tech/.test(cards()[0].textContent) && /1 option(?!s)/.test(cards()[0].textContent) && /\$1,250/.test(cards()[0].textContent), text());
  check("E4 no Go to estimate link (the HCP phone app can't open it); the estimate number is shown to look it up", !cards()[0].querySelector("a") && /Estimate #\d+/.test(cards()[0].textContent), cards()[0].textContent);
  check("E5 no button where there is no link", !cards()[1].querySelector("a"));
  check("E6 an enormous amount is marked to check, and shown in dollars not cents", /\$200,000/.test(cards()[1].textContent) && /check this amount/.test(cards()[1].textContent) && !/check this amount/.test(cards()[0].textContent));
  check("E7 the outcome badges read Waiting / Won / Declined", /Waiting/.test(cards()[0].textContent) && /Won/.test(cards()[1].textContent) && /Declined/.test(cards()[2].textContent));
  check("E8 customer names show only when the server sent them", !/Zelda/.test(cards()[0].textContent) && /Zelda Quimby/.test(cards()[2].textContent));
  check("E9 the list tiles: needs review, on the list, won with close rate, won dollars", /Needs review3/.test(document.querySelector('[data-section="list-tiles"]').textContent) && /On the list3/.test(document.querySelector('[data-section="list-tiles"]').textContent) && /33% close/.test(document.querySelector('[data-section="list-tiles"]').textContent) && /\$200,000/.test(document.querySelector('[data-section="list-tiles"]').textContent));
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
  handler = () => ({ ok: true, status: 200, redirected: true, json: async () => { throw new SyntaxError("Unexpected token '<', \"<!DOCTYPE \" is not valid JSON"); } });
  await act(async () => { root.render(React.createElement(React.Fragment, { key: Math.random() }, React.createElement(Page))); }); await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  check("E19b bounced to the sign-in page: it says to sign in again, never the browser's JSON error", /Sign in again/.test(text()) && !/JSON|Unexpected token|DOCTYPE/.test(text()), text().slice(-160));
  handler = () => ({ ok: false, status: 504, json: async () => { throw new SyntaxError("Unexpected token 'A', \"An error o\"... is not valid JSON"); } });
  await act(async () => { root.render(React.createElement(React.Fragment, { key: Math.random() }, React.createElement(Page))); }); await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  check("E19c a timeout (HTTP 504, text instead of JSON) says Housecall Pro took too long", /took too long/.test(text()) && !/JSON|Unexpected token/.test(text()), text().slice(-160));
  handler = () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError("Unexpected token '<'"); } });
  await act(async () => { root.render(React.createElement(React.Fragment, { key: Math.random() }, React.createElement(Page))); }); await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  check("E19d any other non-JSON answer says what it was (HTTP 502) and to try again", /unexpected \(HTTP 502\)/.test(text()) && /Try again in a minute/.test(text()) && !/JSON|Unexpected token/.test(text()), text().slice(-160));
  handler = () => new Promise(() => {});
  await act(async () => { root.render(React.createElement(React.Fragment, { key: Math.random() }, React.createElement(Page))); });
  check("E20 while waiting it says Loading", !!document.querySelector('[data-state="loading"]') && /Loading/.test(text()));

  // ===== review workflow =====
  try { window.localStorage.removeItem("tgdg.reviewerName"); } catch {}
  const reviewed = (o = {}) => row({ reviewed: true, reviewedBy: "Dana", reviewedAt: "2026-10-18T20:00:00Z", reviewedAtLabel: "Oct 18, 8:00 PM", note: "left voicemail", changedSinceReview: false, needsReview: false, ...o });
  const reviewReport = {
    ...report,
    needsReviewCount: 1,
    list: [
      row({ id: "csr_new", number: "9001" }),                                                          // never reviewed -> needs
      reviewed({ id: "csr_done", number: "9002", outcome: "won" }),                                     // reviewed, unchanged -> not needs
      reviewed({ id: "csr_chg", number: "9003", changedSinceReview: true, needsReview: true }),         // reviewed but changed -> needs
    ],
  };
  handler = () => ({ ok: true, status: 200, json: async () => ({ ok: true, checkedAt: "x", report: reviewReport }) });
  await mount();
  const byId = (id) => document.querySelector(`[data-estimate="${id}"]`);
  const shownIds = () => cards().map((c) => c.getAttribute("data-estimate"));

  check("V1 defaults to Needs review: only the untouched and the changed one show", JSON.stringify(shownIds().sort()) === JSON.stringify(["csr_chg", "csr_new"]), JSON.stringify(shownIds()));
  check("V2 the Needs-review count shows on the tile and the filter", /Needs review/.test(document.querySelector('[data-section="list-tiles"]').textContent) && /Needs review \(2\)/.test(document.querySelector('[data-review-filter="needs"]').textContent), document.querySelector('[data-review-filter="needs"]').textContent);
  check("V3 a reviewed-and-unchanged estimate is hidden from Needs review", !byId("csr_done"));
  check("V4 a changed-since-reviewed estimate is flagged and still needs review", /Changed since reviewed/.test(byId("csr_chg").textContent) && byId("csr_chg").getAttribute("data-needs-review") === "true");

  await click('[data-review-filter="reviewed"]');
  check("V5 Reviewed filter shows only the cleanly-reviewed one, with who and when", JSON.stringify(shownIds()) === JSON.stringify(["csr_done"]) && /Reviewed by Dana/.test(byId("csr_done").textContent) && /Oct 18, 8:00 PM/.test(byId("csr_done").textContent));
  await click('[data-review-filter="all"]');
  check("V6 All shows every estimate", shownIds().length === 3);

  // name picker: no name yet -> marking asks for a name first
  await click('[data-review-filter="needs"]');
  reviewCalls.length = 0;
  await act(async () => { byId("csr_new").querySelector('[data-action="review"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  check("V7 with no name set, Mark reviewed asks for the name first and sends nothing", reviewCalls.length === 0 && !!document.querySelector("#reviewer-name"));
  const nameInput = document.querySelector("#reviewer-name");
  await act(async () => { const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; set.call(nameInput, "Jasen"); nameInput.dispatchEvent(new window.Event("input", { bubbles: true })); });
  await act(async () => { document.querySelector('[data-section="reviewer"] form').dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  check("V8 the name is shown and remembered on this device", /Reviewing as Jasen/.test(document.querySelector('[data-section="reviewer"]').textContent) && (() => { try { return window.localStorage.getItem("tgdg.reviewerName") === "Jasen"; } catch { return false; } })());

  // type a note then mark reviewed -> POST carries id, name, note and fingerprint
  const noteInput = byId("csr_new").querySelector('[data-field="note"]');
  await act(async () => { const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; set.call(noteInput, "needs follow-up Tuesday"); noteInput.dispatchEvent(new window.Event("input", { bubbles: true })); });
  reviewCalls.length = 0;
  await act(async () => { byId("csr_new").querySelector('[data-action="review"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  check("V9 Mark reviewed POSTs the id, the reviewer, the note and the fingerprint", reviewCalls.length === 1 && reviewCalls[0].method === "POST" && reviewCalls[0].url === "/api/estimate-reviews" && reviewCalls[0].body.estimateId === "csr_new" && reviewCalls[0].body.reviewedBy === "Jasen" && reviewCalls[0].body.note === "needs follow-up Tuesday" && reviewCalls[0].body.fingerprint === "fp1", JSON.stringify(reviewCalls[0] && reviewCalls[0].body));
  check("V10 the row updates in place and leaves Needs review, no page reload", !byId("csr_new") && shownIds().includes("csr_chg") && !shownIds().includes("csr_new"));
  await click('[data-review-filter="reviewed"]');
  check("V11 it is now under Reviewed, signed by the name", /Reviewed by Jasen/.test(byId("csr_new").textContent) && /needs follow-up Tuesday/.test((() => { const i = byId("csr_new").querySelector('[data-field="note"]'); return i ? i.value : ""; })()));

  // clear a review -> DELETE, back to needs
  reviewCalls.length = 0;
  await act(async () => { byId("csr_new").querySelector('[data-action="unreview"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  check("V12 Clear sends a DELETE for that estimate", reviewCalls.length === 1 && reviewCalls[0].method === "DELETE" && /\/api\/estimate-reviews\?id=csr_new/.test(reviewCalls[0].url));
  await click('[data-review-filter="needs"]');
  check("V13 ...and it returns to Needs review", shownIds().includes("csr_new"));

  // a failed save surfaces the server's message on the row
  reviewHandler = () => ({ ok: false, status: 400, json: async () => ({ error: "Set your name first, so the review is signed." }) });
  reviewCalls.length = 0;
  await act(async () => { byId("csr_chg").querySelector('[data-action="review"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  check("V14 a failed save shows the message and leaves the row needing review", /Set your name first/.test(byId("csr_chg").textContent) && byId("csr_chg").getAttribute("data-needs-review") === "true");
  reviewHandler = () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });

  // export + print controls exist and don't blow up
  check("V15 Export CSV and Print / PDF buttons are offered", !!document.querySelector('[data-action="export-csv"]') && !!document.querySelector('[data-action="print"]'));
  exported.length = 0;
  await act(async () => { document.querySelector('[data-action="export-csv"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
  check("V16 Export CSV builds a CSV download", exported.length === 1 && exported[0] && exported[0].type.includes("text/csv"));
  await act(async () => { document.querySelector('[data-action="print"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
  check("V17 Print does not throw even when the browser blocks the pop-up", true);
  window.open = origOpen;

  await act(async () => { root.unmount(); });
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(2); });
