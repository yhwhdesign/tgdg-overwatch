// The Orders page (Admin) against a fake server.
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");
const path = require("path");
let passes = 0, failures = 0;
const check = (name, ok, detail = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${name}${detail ? "  <- " + detail : ""}`); } };
(async () => {
  const out = await esbuild.build({ entryPoints: [path.join(__dirname, "../../src/app/admin/orders/page.tsx")], bundle: true, write: false, format: "cjs", platform: "node", jsx: "automatic", alias: { "@": path.join(__dirname, "../../src") }, nodePaths: [path.join(__dirname, "../../node_modules")], external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom"], logLevel: "silent" });
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost:3000/admin/orders", pretendToBeVisual: true });
  const { window } = dom;
  Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement, Event: window.Event, MouseEvent: window.MouseEvent });
  window.confirm = () => true;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require("react"); const { createRoot } = require("react-dom/client"); const { act } = React;
  const mod = { exports: {} }; new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  const Page = mod.exports.default;

  const V = { id: "v1", name: "Clopay Supply", website: "https://clopay.com/", portalUrl: "https://dealer.clopay.com/orders", accountNumber: "A-77", contactName: null, phone: null, email: null, notes: null, active: true };
  const O = (o) => ({ id: "o1", kind: "customer", status: "ordered", poNumber: "PO-9", vendorId: "v1", vendor: { id: "v1", name: "Clopay Supply", portalUrl: V.portalUrl, website: V.website }, jobNumber: "4521", estimateNumber: null, items: "2x 16x7 springs", costCents: 25000, orderedOn: "2026-10-20", expectedOn: "2026-10-30", arrivedOn: null, trackingNumber: null, notes: null, createdAt: "2026-10-20T00:00:00Z", ...o });
  let DATA = { today: "2026-11-01", orders: [O(), O({ id: "o2", status: "to-order", items: "Opener", vendor: null, vendorId: null, expectedOn: null, jobNumber: null, estimateNumber: "8802" }), O({ id: "o3", status: "done", items: "Old rollers", expectedOn: null })], summary: { needsOrdering: 1, onTheWay: 1, late: 1, arrivedNotDone: 0, openCostCents: 50000 }, vendors: [V] };
  const calls = [];
  let listStatus = 200;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : undefined, type: init.headers && init.headers["content-type"] });
    if (String(url) === "/api/admin/orders" && (init.method ?? "GET") === "GET") return { ok: listStatus === 200, status: listStatus, json: async () => (listStatus === 200 ? DATA : { error: "Not signed in." }) };
    if (String(url) === "/api/admin/orders" && init.method === "POST") { const b = JSON.parse(init.body); if (!b.items) return { ok: false, status: 400, json: async () => ({ error: "Say what was ordered." }) }; return { ok: true, status: 201, json: async () => ({}) }; }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const root = createRoot(document.getElementById("root"));
  const text = () => document.body.textContent.replace(/\s+/g, " ").trim();
  const q = (s, el = document) => [...el.querySelectorAll(s)];
  const click = async (el) => { await act(async () => { el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); }); await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
  const setVal = async (el, value) => { await act(async () => { const proto = el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value); el.dispatchEvent(new window.Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); }); await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
  const mount = async () => { await act(async () => { root.render(React.createElement(React.Fragment, { key: Math.random() }, React.createElement(Page))); }); await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };

  listStatus = 401; await mount();
  check("P1 not signed in: says to sign in on Admin, shows no orders", !!document.querySelector('[data-state="signedOut"]') && !document.querySelector('[data-section="orders"]'));
  listStatus = 200; await mount();
  check("P2 summary tiles", document.querySelector('[data-tile="late"]').textContent.includes("1") && document.querySelector('[data-tile="to-order"]').textContent.includes("1") && text().includes("Open orders total $500.00"));
  const open = q("[data-order]").map((li) => li.getAttribute("data-order"));
  check("P3 opens on Open orders: done orders hidden", JSON.stringify(open) === JSON.stringify(["o1", "o2"]), JSON.stringify(open));
  const late = document.querySelector('[data-order="o1"]');
  check("P4 a late order is flagged red with its expected date", late.getAttribute("data-late") === "true" && late.textContent.includes("Late: expected Oct 30"));
  check("P5 the order shows job #, vendor, PO and cost", late.textContent.includes("Job #4521 · Clopay Supply · PO PO-9 · $250.00"), late.textContent);
  const portal = late.querySelector('[data-action="vendor-page"]');
  check("P6 a link to the vendor's order page opens a new tab safely", portal && portal.href === "https://dealer.clopay.com/orders" && portal.target === "_blank" && /noopener/.test(portal.rel));
  check("P7 no links to Housecall Pro anywhere", q('a[href*="housecallpro"]').length === 0);
  await click(document.querySelector('[data-filter="closed"]'));
  check("P8 Done / cancelled filter", JSON.stringify(q("[data-order]").map((li) => li.getAttribute("data-order"))) === JSON.stringify(["o3"]));
  await click(document.querySelector('[data-filter="open"]'));

  // quick status change sends the whole order with the new status
  calls.length = 0;
  await setVal(document.querySelector('[data-order="o1"] [data-action="status"]'), "arrived");
  const put = calls.find((c) => c.method === "PUT");
  check("P9 changing status saves the whole order with the new status, as JSON", put && put.url === "/api/admin/orders/o1" && put.body.status === "arrived" && put.body.items === "2x 16x7 springs" && put.body.cost === "250.00" && put.type === "application/json", JSON.stringify(put));

  // add an order
  await click(document.querySelector('[data-action="add-order"]'));
  const form = document.querySelector('[data-form="order"]');
  await act(async () => { form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  check("P10 saving with nothing ordered shows the server's message", (document.querySelector('[data-form="order"] [data-field="error"]') || {}).textContent === "Say what was ordered.");
  await setVal(form.querySelector('[name="items"]'), "3x weather seal");
  await setVal(form.querySelector('[name="jobNumber"]'), "#4600");
  await setVal(form.querySelector('[name="cost"]'), "45");
  calls.length = 0;
  await act(async () => { form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  const post = calls.find((c) => c.method === "POST");
  check("P11 a new order is sent with empty fields as null", post && post.body.items === "3x weather seal" && post.body.jobNumber === "#4600" && post.body.cost === "45" && post.body.poNumber === null && post.body.kind === "customer", JSON.stringify(post && post.body));
  check("P12 ...and the list reloads after saving", calls.some((c) => c.url === "/api/admin/orders" && c.method === "GET") && !document.querySelector('[data-form="order"]'));

  // vendors
  const vli = document.querySelector('[data-vendor="v1"]');
  check("P13 vendor shows account # and both links", vli.textContent.includes("Acct A-77") && vli.querySelector('[data-action="portal"]').href === "https://dealer.clopay.com/orders" && vli.querySelector('[data-action="website"]').href === "https://clopay.com/");
  await click(document.querySelector('[data-action="add-vendor"]'));
  check("P14 the vendor form says passwords are never stored, and has no password field", text().includes("Passwords are never stored here") && !document.querySelector('[data-form="vendor"] input[type="password"]') && !document.querySelector('[data-form="vendor"] [name*="pass" i]'));

  // delete
  calls.length = 0;
  await click(document.querySelector('[data-order="o2"] [data-action="delete"]'));
  check("P15 delete asks first, then sends DELETE as JSON", calls.some((c) => c.method === "DELETE" && c.url === "/api/admin/orders/o2" && c.type === "application/json"));

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(2); });
