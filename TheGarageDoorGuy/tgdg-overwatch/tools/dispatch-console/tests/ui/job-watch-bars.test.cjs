const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");
const path = require("path");
let passes = 0, failures = 0;
const check = (name, ok, detail = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${name}${detail ? "  <- " + detail : ""}`); } };
(async () => {
  const out = await esbuild.build({ entryPoints: [path.join(__dirname, "../../src/app/JobWatchBars.tsx")], bundle: true, write: false, format: "cjs", platform: "node", jsx: "automatic", alias: { "@": path.join(__dirname, "../../src") }, nodePaths: [path.join(__dirname, "../../node_modules")], external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom"], logLevel: "silent" });
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost:3000/", pretendToBeVisual: true });
  const { window } = dom;
  Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement, Event: window.Event, StorageEvent: window.StorageEvent });
  Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require("react"); const { createRoot } = require("react-dom/client"); const { act } = React;
  const mod = { exports: {} }; new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  const { JobWatchBars, JobWatchStatus } = mod.exports;
  // the store is bundled into the same file; reach it through a second small bundle so tests can reset it
  const out2 = await esbuild.build({ entryPoints: [path.join(__dirname, "../../src/app/job-watch-store.ts")], bundle: true, write: false, format: "cjs", platform: "node", alias: { "@": path.join(__dirname, "../../src") }, logLevel: "silent" });
  void out2; // (the component bundle has its own copy; tests reset by unmounting, which stops the checker)

  const calls = []; let answer;
  const respond = (status, body, extra = {}) => ({ ok: status >= 200 && status < 300, status, redirected: false, json: async () => { if (body === undefined) throw new Error("not json"); return body; }, ...extra });
  globalThis.fetch = async (url, init) => { calls.push(String(url)); return answer(url, init); };
  const root = createRoot(document.getElementById("root"));
  const settle = async (ms = 10) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
  const page = () => React.createElement("div", null, React.createElement(JobWatchBars), React.createElement("header", null, React.createElement(JobWatchStatus)));
  const mount = async () => { calls.length = 0; await act(async () => { root.render(React.createElement(React.Fragment, { key: Math.random() }, page())); }); await settle(); };
  const unmount = async () => { await act(async () => { root.render(null); }); };
  const bars = () => [...document.querySelectorAll("[data-bar]")];
  const status = () => document.querySelector('[data-job-watch="status"]');
  const click = async (el) => { await act(async () => { el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); }); await settle(); };

  const nowIso = new Date().toISOString();
  const startedAgo = (min) => new Date(Date.now() - min * 60000).toISOString();
  const body = (over = {}) => ({ ok: true, checkedAt: nowIso, watching: 2, cantTell: 0, ignoredOlder: 0, alerts: [
    { id: "job_1@90", kind: "install", label: "Install #100", techs: ["Alex", "Blake"], startedAt: startedAgo(125), startedLabel: "3:55 PM", minutesOnJob: 125, limitMinutes: 90, url: "https://pro.housecallpro.com/app/jobs/job_1" },
    { id: "csr_3@3d", kind: "estimate", label: "Estimate #13145 ($192)", techs: ["Stoney Wade"], startedAt: startedAgo(4859), startedLabel: "Oct 16", minutesOnJob: 4859, limitMinutes: 4320, url: "https://pro.housecallpro.com/app/estimates/csr_3" },
  ], completed: [
    { id: "job_a#1", kind: "service", label: "Residential service #40883", techs: ["Josh Bayliss"], completedAt: nowIso, completedLabel: "5:11 PM", minutesOnJob: 8, notes: ["Need remote programed here.", "programmed remote. job complete"], notesPending: false, notesHidden: false, url: "https://pro.housecallpro.com/app/jobs/job_a" },
    { id: "job_b#2", kind: "service", label: "Repair #2", techs: ["Kris"], completedAt: nowIso, completedLabel: "3:39 PM", minutesOnJob: null, notes: [], notesPending: false, notesHidden: false, url: "https://evil.example.com/x" },
  ], ...over });
  const ownText = (el) => el.textContent.replace(/\s+/g, " ").trim();

  // ---- A. what a first look shows
  answer = () => respond(200, body());
  window.localStorage.clear();
  await mount();
  check("A1 it asks the server once, at /api/job-watch", calls.length === 1 && calls[0] === "/api/job-watch", JSON.stringify(calls));
  check("A2 two bars are shown red first: the install, then the estimate (the shown limit is 3, so one green fits)", bars().length === 3 && bars().map((b) => b.dataset.bar).join() === "over,over,done", bars().map((b) => b.dataset.bar).join());
  check("A3 the install bar names the techs, the job and the time", /Alex and Blake have been on "Install #100" for 2h \d+m/.test(ownText(bars()[0])) && /Longer than the normal 1h 30m/.test(ownText(bars()[0])), ownText(bars()[0]));
  check("A4 the estimate bar speaks in days", /Estimate #13145 \(\$192\) has had no answer for 3 days/.test(ownText(bars()[1])), ownText(bars()[1]));
  check("A5 the finished bar shows who, how long and the notes", /Josh Bayliss finished "Residential service #40883"/.test(ownText(bars()[2])) && /after 8m/.test(ownText(bars()[2])) && /Need remote programed here\./.test(bars()[2].querySelector('[data-field="notes"]').textContent) && /programmed remote\. job complete/.test(bars()[2].querySelector('[data-field="notes"]').textContent));
  check("A6 the +N more line counts the hidden bar", document.querySelector('[data-field="more"]') && /\+1 more/.test(document.querySelector('[data-field="more"]').textContent));
  check("A7 the status line says how many are on jobs", status() && /2 on jobs/.test(status().textContent) && status().dataset.tone === "ok", status() && status().textContent);
  const goLinks = [...document.querySelectorAll('[data-action="go"]')];
  // The Housecall Pro phone app shows "page not found" for web links, so there are no Go to job / estimate links:
  // dispatchers look the number up in HCP (it is in every title).
  check("A8 no Go to job / Go to estimate links, and no links to Housecall Pro at all", goLinks.length === 0 && document.querySelectorAll('a[href*="housecallpro"]').length === 0, goLinks.map((a) => a.textContent).join(" | "));
  check("A9 red bars are alerts, green bars are status messages (for screen readers)", bars()[0].getAttribute("role") === "alert" && bars()[2].getAttribute("role") === "status");
  check("A10 the bars stick to the top of the page", document.querySelector('[data-job-watch="bars"]').className.includes("sticky"));

  // ---- B. dismissing
  await click(bars()[0].querySelector('[data-action="dismiss"]'));
  check("B1 Dismiss removes that bar and the next one moves up", bars().length === 3 && !bars().some((b) => b.dataset.barId === "job_1@90") && bars().some((b) => b.dataset.barId === "job_b#2") && !document.querySelector('[data-field="more"]'), bars().map((b) => b.dataset.barId).join());
  const stored = JSON.parse(window.localStorage.getItem("overwatch.jobwatch.dismissed") || "{}");
  check("B2 the dismissal is remembered in the browser", Object.keys(stored).join() === "job_1@90" && Date.now() - stored["job_1@90"] < 5000, JSON.stringify(stored));
  await unmount(); await mount();
  check("B3 after a reload the dismissed bar stays gone", !bars().some((b) => b.dataset.barId === "job_1@90"));
  const orphanGreen = bars().find((b) => b.dataset.barId === "job_b#2");
  check("B4 a finished job with no notes says so, and an outside link is not offered", orphanGreen && /No notes were left\./.test(orphanGreen.textContent) && !orphanGreen.querySelector('[data-action="go"]'));
  window.localStorage.setItem("overwatch.jobwatch.dismissed", JSON.stringify({ "job_1@90": Date.now() - 25 * 3600 * 1000 }));
  await unmount(); await mount();
  check("B5 a dismissal older than a day is forgotten and the bar returns", bars().some((b) => b.dataset.barId === "job_1@90"));
  window.localStorage.setItem("overwatch.jobwatch.dismissed", "{not json");
  await unmount(); await mount();
  check("B6 unreadable saved dismissals are ignored (bars still show)", bars().length === 3);
  // another tab dismisses something
  window.localStorage.setItem("overwatch.jobwatch.dismissed", JSON.stringify({ "csr_3@3d": Date.now() }));
  await act(async () => { window.dispatchEvent(new window.StorageEvent("storage", { key: "overwatch.jobwatch.dismissed" })); });
  check("B7 a dismissal made in another tab or the docked window shows up here too", !bars().some((b) => b.dataset.barId === "csr_3@3d"));

  // ---- C. quiet and trouble
  window.localStorage.clear();
  answer = () => respond(200, body({ watching: 0, alerts: [], completed: [] }));
  await unmount(); await mount();
  check("C1 nothing to report: no bars, and the status says no one is on a job", bars().length === 0 && !document.querySelector('[data-job-watch="bars"]') && /No one on a job/.test(status().textContent));
  answer = () => respond(200, body({ watching: 1, alerts: [], completed: [], cantTell: 2, ignoredOlder: 1 }));
  await unmount(); await mount();
  check("C2 one person: '1 on a job', and the tooltip explains jobs it cannot watch", /1 on a job/.test(status().textContent) && /2 jobs in progress have no Start tap/.test(status().title) && /1 job started on an earlier day/.test(status().title), status().title);
  answer = () => { throw new Error("offline"); };
  await unmount(); await mount();
  check("C3 the first failed check shows the status without crying wolf (amber)", status() && status().dataset.tone === "trouble" && /Can't reach the console/.test(status().title), status() && status().title);
  answer = () => respond(401, { error: "x" });
  await unmount(); await mount();
  check("C4 a 401 says to sign in again", status() && /Sign in again/.test(status().title), status() && status().title);
  answer = () => respond(200, undefined, { redirected: true });
  await unmount(); await mount();
  check("C5 being bounced to the sign-in page counts as signed out, not as 'no jobs'", status() && /Sign in again/.test(status().title));
  answer = () => respond(500, { ok: false, error: "x" });
  await unmount(); await mount();
  check("C6 a server error is named", status() && /HTTP 500/.test(status().title));
  answer = () => respond(200, { ok: false, error: "Housecall Pro key missing" });
  await unmount(); await mount();
  check("C7 {ok:false} is a failure with the server's own words", status() && /Housecall Pro key missing/.test(status().title), status() && status().title);
  answer = () => respond(200, "<html>sign in</html>");
  await unmount(); await mount();
  check("C8 a surprise (a string where an object should be) never breaks the page", !!status());

  // ---- D. polling: shared, only visible, offline after three misses, keeps last alerts
  answer = () => respond(200, body());
  await unmount(); await mount();
  check("D0 bars AND status share ONE request (not two)", calls.length === 1, JSON.stringify(calls));
  // swap time functions to drive intervals
  const realSetInterval = global.setInterval; const fakes = [];
  const out3 = await esbuild.build({ entryPoints: [path.join(__dirname, "../../src/app/job-watch-store.ts")], bundle: true, write: false, format: "cjs", platform: "node", alias: { "@": path.join(__dirname, "../../src") }, logLevel: "silent" });
  const store = { exports: {} };
  global.setInterval = (fn, ms) => { fakes.push({ fn, ms }); return fakes.length; }; const realClear = global.clearInterval; global.clearInterval = () => {};
  new Function("module", "exports", "require", out3.outputFiles[0].text)(store, store.exports, require);
  const S = store.exports;
  const seen = []; calls.length = 0;
  answer = () => respond(200, body({ alerts: [], completed: [] }));
  const unsub = S.subscribe(() => seen.push(1));
  const unsub2 = S.subscribe(() => {});
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  check("D1 two listeners start only one checker (one request, two timers)", calls.length === 1 && fakes.length === 2 && fakes.map((f) => f.ms).sort((a, b) => a - b).join() === `${S.TICK_MS},${S.POLL_MS}`, JSON.stringify({ calls, ms: fakes.map((f) => f.ms) }));
  const pollFn = fakes.find((f) => f.ms === S.POLL_MS).fn;
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  calls.length = 0; pollFn(); await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  check("D2 a hidden tab does not ask", calls.length === 0);
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  pollFn(); await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  check("D3 a visible tab asks again", calls.length === 1);
  answer = () => { throw new Error("down"); };
  for (let i = 0; i < 3; i++) { pollFn(); await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); }
  check("D4 three misses in a row: offline", S.getView().snapshot.state === "offline" && S.getView().snapshot.failures === 3, JSON.stringify(S.getView().snapshot.state));
  answer = () => respond(200, body());
  pollFn(); await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  check("D5 one good check brings it back", S.getView().snapshot.state === "ok" && S.getView().snapshot.alerts.length === 2);
  let slowResolve; answer = () => new Promise((res) => { slowResolve = res; });
  calls.length = 0; pollFn(); pollFn(); pollFn();
  check("D6 a check still running is never doubled up", calls.length === 1);
  slowResolve(respond(200, body())); await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  unsub(); check("D7 with one listener left the checker keeps running", S.getView() !== null);
  unsub2();
  S.__resetForTests();
  global.setInterval = realSetInterval; global.clearInterval = realClear;
  check("D8 reset returns to the not-yet-checked state", S.getView().snapshot.state === "starting");
  check("D9 on the server (before the browser takes over) nothing is drawn", S.getServerView().snapshot.state === "starting" && S.getServerView().now === 0);

  console.log(`${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log("CRASH", e); process.exit(1); });
