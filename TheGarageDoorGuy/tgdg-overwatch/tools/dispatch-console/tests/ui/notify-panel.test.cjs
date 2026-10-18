const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");
const path = require("path");
let passes = 0, failures = 0;
const check = (name, ok, detail = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${name}${detail ? "  <- " + detail : ""}`); } };
(async () => {
  const out = await esbuild.build({ entryPoints: [path.join(__dirname, "../../src/app/admin/NotifyPanel.tsx")], bundle: true, write: false, format: "cjs", platform: "node", jsx: "automatic", alias: { "@": path.join(__dirname, "../../src") }, nodePaths: [path.join(__dirname, "../../node_modules")], external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom"], logLevel: "silent" });
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost:3000/admin", pretendToBeVisual: true });
  const { window } = dom;
  Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement, Event: window.Event });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require("react"); const { createRoot } = require("react-dom/client"); const { act } = React;
  const mod = { exports: {} }; new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  const Page = mod.exports.default;
  let handler = null; const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return handler(); };
  const root = createRoot(document.getElementById("root"));
  const text = () => document.body.textContent.replace(/\s+/g, " ").trim();
  const mount = async () => { calls.length = 0; await act(async () => { root.render(React.createElement(React.Fragment, { key: Math.random() }, React.createElement(Page))); }); await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };

  const kinds = [{ id: "estimate-finished", label: "Tech finished an estimate" }, { id: "estimate-waiting", label: "Office estimate unanswered" }, { id: "job-over", label: "Job running over time" }, { id: "job-finished", label: "Tech finished a job" }];
  const topicA = "tgdg-" + "a".repeat(24);
  let people, schedulerReady = true; const writes = [];
  const respond = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || "GET"; const body = init.body ? JSON.parse(init.body) : null;
    calls.push(method + " " + url + (body ? " " + JSON.stringify(body) : ""));
    if (handler) return handler(method, String(url), body);
    if (url === "/api/admin/notify" && method === "GET") return respond(200, { people, kinds, server: "https://ntfy.sh", schedulerReady });
    if (url === "/api/admin/notify" && method === "POST") { const p = { id: "n" + (people.length + 1), name: body.name, topic: "tgdg-" + "z".repeat(24), kinds: [], enabled: true }; people.push(p); writes.push(body); return respond(201, { person: p }); }
    if (url === "/api/admin/notify" && method === "PUT") { Object.assign(people.find((p) => p.id === body.id), body); writes.push(body); return respond(200, {}); }
    if (url === "/api/admin/notify" && method === "DELETE") { people = people.filter((p) => p.id !== body.id); return respond(200, { ok: true }); }
    if (url === "/api/admin/notify/test") return respond(200, { ok: true });
    return respond(404, {});
  };
  let signedOut = 0;
  const mountPanel = async (names = ["Alex Tech", "Blake Tech", "Jasen B"]) => { calls.length = 0; writes.length = 0; await act(async () => { root.render(React.createElement(React.Fragment, { key: Math.random() }, React.createElement(Page, { techNames: names, onSignedOut: () => { signedOut++; } }))); }); await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
  const click = async (el) => { await act(async () => { el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); }); await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
  const rows = () => [...document.querySelectorAll("[data-person]")];

  people = [{ id: "n1", name: "Jasen", topic: topicA, kinds: ["estimate-finished"], enabled: true }, { id: "n2", name: "Dispatch", topic: "tgdg-" + "c".repeat(24), kinds: [], enabled: false }];
  await mountPanel();
  check("N1 it loads the list once and shows each person with a bell and four alert buttons", calls.filter((c) => c === "GET /api/admin/notify").length === 1 && rows().length === 2 && rows().every((r) => r.querySelectorAll("[data-kind]").length === 4 && !!r.querySelector('[data-action="bell"]')), JSON.stringify(calls));
  check("N2 the legend explains the four codes", /EF/.test(text()) && /Tech finished an estimate/.test(text()) && /Office estimate unanswered/.test(text()) && /Job running over time/.test(text()) && /Tech finished a job/.test(text()));
  check("N3 the bell and the chosen alerts show their state", rows()[0].querySelector('[data-action="bell"]').getAttribute("aria-pressed") === "true" && rows()[1].querySelector('[data-action="bell"]').getAttribute("aria-pressed") === "false" && rows()[0].querySelector('[data-kind="estimate-finished"]').getAttribute("aria-pressed") === "true" && rows()[0].querySelector('[data-kind="job-over"]').getAttribute("aria-pressed") === "false");
  await click(rows()[0].querySelector('[data-kind="job-over"]'));
  check("N4 tapping an alert turns it on and saves just that change", writes.length === 1 && JSON.stringify(writes[0]) === JSON.stringify({ id: "n1", kinds: ["estimate-finished", "job-over"] }) && rows()[0].querySelector('[data-kind="job-over"]').getAttribute("aria-pressed") === "true", JSON.stringify(writes));
  await click(rows()[0].querySelector('[data-kind="estimate-finished"]'));
  check("N5 tapping it again turns it off", JSON.stringify(writes[1]) === JSON.stringify({ id: "n1", kinds: ["job-over"] }) && rows()[0].querySelector('[data-kind="estimate-finished"]').getAttribute("aria-pressed") === "false");
  await click(rows()[1].querySelector('[data-action="bell"]'));
  check("N6 the bell switches a person on", JSON.stringify(writes[2]) === JSON.stringify({ id: "n2", enabled: true }) && rows()[1].querySelector('[data-action="bell"]').getAttribute("aria-pressed") === "true");
  await click(rows()[0].querySelector('[data-action="test"]'));
  check("N7 Send test asks the server and says it was sent", calls.includes('POST /api/admin/notify/test {"id":"n1"}') && !!document.querySelector('[data-state="note-ok"]') && /Test sent to Jasen/.test(text()), text().slice(-200));
  check("N8 phone setup is hidden until asked for, then shows the channel name and the link", !document.querySelector('[data-section="setup"]'));
  await click(rows()[0].querySelector('[data-action="setup"]'));
  check("N9 ...the channel name and the link, with the warning to treat it like a password", document.querySelector('[data-field="topic"]').textContent === topicA && document.querySelector('[data-section="setup"] a').href === `https://ntfy.sh/${topicA}` && /like a password/.test(text()));
  await click(rows()[0].querySelector('[data-action="setup"]'));
  check("N10 and it hides again", !document.querySelector('[data-section="setup"]'));
  const input = document.querySelector('[data-section="notify-add"] input');
  check("N11 the add box offers the Housecall Pro names that are not already on the list", [...document.querySelectorAll("#notify-names option")].map((o) => o.value).join() === "Alex Tech,Blake Tech,Jasen B");
  await act(async () => { const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; setter.call(input, "Blake Tech"); input.dispatchEvent(new window.Event("input", { bubbles: true })); });
  await act(async () => { document.querySelector('[data-section="notify-add"]').dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); await new Promise((r) => setTimeout(r, 10)); });
  check("N12 adding a person sends the name, shows them, clears the box and opens their phone setup", writes.some((w) => w.name === "Blake Tech") && rows().length === 3 && rows()[2].textContent.includes("Blake Tech") && input.value === "" && !!document.querySelector('[data-section="setup"]'), JSON.stringify(writes));
  window.confirm = () => false;
  await click(rows()[2].querySelector('[data-action="remove"]'));
  check("N13 Remove asks first; saying no keeps them", rows().length === 3);
  window.confirm = () => true;
  await click(rows()[2].querySelector('[data-action="remove"]'));
  check("N14 saying yes removes them", rows().length === 2 && !text().includes("Blake Tech"));

  people = []; await mountPanel();
  check("N15 an empty list says so", /Nobody is on the list yet/.test(text()) && rows().length === 0);
  people = []; schedulerReady = false; await mountPanel();
  check("N16 when the server has no scheduler secret it says notifications cannot be sent yet", !!document.querySelector('[data-state="no-scheduler"]') && /CRON_SECRET/.test(text()));
  schedulerReady = true;

  people = [{ id: "n1", name: "Jasen", topic: topicA, kinds: [], enabled: true }];
  handler = (method, url, body) => method === "PUT" ? respond(400, { error: "kinds must be a list of known alert types." }) : respond(200, { people, kinds, server: "https://ntfy.sh", schedulerReady: true });
  await mountPanel();
  await click(rows()[0].querySelector('[data-kind="job-over"]'));
  check("N17 a save that fails puts the button back and shows the server's message", rows()[0].querySelector('[data-kind="job-over"]').getAttribute("aria-pressed") === "false" && !!document.querySelector('[data-state="note-error"]') && /known alert types/.test(text()));
  handler = (method, url) => method === "POST" && url.endsWith("/test") ? respond(502, { ok: false, error: "The notification service could not be reached." }) : respond(200, { people, kinds, server: "https://ntfy.sh", schedulerReady: true });
  await mountPanel();
  await click(rows()[0].querySelector('[data-action="test"]'));
  check("N18 a failed test shows the problem", !!document.querySelector('[data-state="note-error"]') && /could not be reached/.test(text()));
  handler = () => respond(401, {});
  signedOut = 0; await mountPanel();
  check("N19 if the sign-in has expired it tells the screen to go back to the login", signedOut >= 1 && rows().length === 0);
  handler = () => { throw new Error("offline"); };
  await mountPanel();
  check("N20 server unreachable: a plain error, no list", !!document.querySelector('[data-state="error"]') && rows().length === 0);
  handler = (method, url) => respond(200, { people: [{ id: "n1", name: "<b>Bold</b>", topic: topicA, kinds: ["bogus"], enabled: true }], kinds, server: "https://ntfy.sh", schedulerReady: true });
  await mountPanel();
  check("N21 HTML in a name is shown as plain text, and an unknown kind in the data does not break anything", rows().length === 1 && !document.querySelector("b") && /<b>Bold<\/b>/.test(text()));
  await act(async () => { root.unmount(); });
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(2); });
