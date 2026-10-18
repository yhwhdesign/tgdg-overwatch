// public/sw.js (what runs on the phone when an alert arrives), run in a sandbox with a fake service-worker scope.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
let passes = 0, failures = 0;
const check = (name, ok, detail = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${name}${detail ? "  <- " + detail : ""}`); } };
const code = fs.readFileSync(path.join(__dirname, "../../public/sw.js"), "utf8");

function scope() {
  const handlers = {}; const shown = []; const opened = []; const state = { skipped: 0, claimed: 0 };
  const self = {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: () => { state.skipped++; },
    clients: { claim: async () => { state.claimed++; }, openWindow: async (u) => { opened.push(u); } },
    registration: { showNotification: async (title, o) => { shown.push({ title, ...o }); } },
  };
  vm.runInNewContext(code, { self, String, JSON, Promise, RegExp });
  const fire = async (type, ev) => { const waits = []; await handlers[type]({ ...ev, waitUntil: (p) => waits.push(p) }); await Promise.all(waits); };
  return { handlers, shown, opened, state, fire };
}
const pushEvent = (data) => ({ data: { json: () => (typeof data === "string" ? JSON.parse(data) : data), text: () => String(data) } });

(async () => {
  let s = scope();
  check("S1 it listens for exactly install, activate, push and notificationclick", JSON.stringify(Object.keys(s.handlers).sort()) === JSON.stringify(["activate", "install", "notificationclick", "push"]));
  await s.fire("install", {}); await s.fire("activate", {});
  check("S2 a new version takes over straight away", s.state.skipped === 1 && s.state.claimed === 1);
  await s.fire("push", pushEvent({ title: "Estimate finished", body: "Alex finished it.", url: "https://pro.housecallpro.com/app/estimates/csr_1", tag: "memo" }));
  check("S3 a push shows a notification with the title, body, icon and the link kept for the tap", s.shown.length === 1 && s.shown[0].title === "Estimate finished" && s.shown[0].body === "Alex finished it." && s.shown[0].icon === "/icon-192.png" && s.shown[0].data.url === "https://pro.housecallpro.com/app/estimates/csr_1");
  await s.fire("push", pushEvent({ title: "T", body: "b", url: "javascript:alert(1)" }));
  await s.fire("push", pushEvent({ title: "T", body: "b", url: "http://insecure.example.com" }));
  check("S4 a link that is not https is dropped, never kept", s.shown[1].data.url === null && s.shown[2].data.url === null);
  await s.fire("push", { data: { json: () => { throw new Error("bad"); }, text: () => "plain words" } });
  check("S5 a push that is not JSON still shows its text (a push must always show something)", s.shown[3].body === "plain words" && s.shown[3].title === "TGDG Overwatch");
  await s.fire("push", { data: null });
  check("S6 an empty push still shows a notification", s.shown.length === 5 && s.shown[4].title === "TGDG Overwatch");
  await s.fire("push", pushEvent({ title: "x".repeat(500), body: "y".repeat(5000) }));
  check("S7 a huge title and body are cut", s.shown[5].title.length === 100 && s.shown[5].body.length === 1000);
  let closed = 0;
  await s.fire("notificationclick", { notification: { close: () => { closed++; }, data: { url: "https://pro.housecallpro.com/app/jobs/job_1" } } });
  check("S8 tapping an alert closes it and opens its link", closed === 1 && s.opened[0] === "https://pro.housecallpro.com/app/jobs/job_1");
  await s.fire("notificationclick", { notification: { close: () => { closed++; }, data: { url: null } } });
  await s.fire("notificationclick", { notification: { close: () => { closed++; }, data: { url: "javascript:alert(1)" } } });
  await s.fire("notificationclick", { notification: { close: () => { closed++; }, data: null } });
  check("S9 an alert with no link, an unsafe link or no data just closes and opens nothing", closed === 4 && s.opened.length === 1);
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(2); });
