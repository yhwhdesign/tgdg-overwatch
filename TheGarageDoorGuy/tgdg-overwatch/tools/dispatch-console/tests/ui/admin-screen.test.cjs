const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");
const path = require("path");
let passes = 0, failures = 0;
const check = (name, ok, detail = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${name}${detail ? "  <- " + detail : ""}`); } };

(async () => {
  const out = await esbuild.build({
    entryPoints: [path.join(__dirname, "../../src/app/admin/page.tsx")], bundle: true, write: false, format: "cjs", platform: "node", jsx: "automatic",
    alias: { "@": path.join(__dirname, "../../src") }, nodePaths: [path.join(__dirname, "../../node_modules")],
    external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom"], logLevel: "silent",
  });
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost:3000/admin", pretendToBeVisual: true });
  const { window } = dom;
  Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement, Event: window.Event, MouseEvent: window.MouseEvent });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require("react"); const { createRoot } = require("react-dom/client"); const { act } = React;

  // ---- fake backend with switchable behavior ----
  let techs, listStatus = 200, loginResult, putResult, calls = [];
  let adminStatusResult = () => ({ ok: false, status: 404, json: async () => ({}) }), refreshResult = () => ({ ok: false, status: 404, json: async () => ({}) });
  const T = (id, name, role, classification = null) => ({ id, name, hcpRole: role, classification });
  const baseTechs = () => [T("t_a", "Stoney Wade", "field tech"), T("t_b", "Drayton Wilson", "field tech", "residential"), T("t_c", "Jasen Burkett", "admin"), T("t_d", "Chris Parkman", "field tech", "hybrid"), T("t_e", "Brooke Macks", "office staff")];
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method ?? "GET"; calls.push({ url: String(url), method, body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
    if (url === "/api/admin/technicians" && method === "GET") { if (listStatus === -1) throw new Error("offline"); return listStatus === 200 ? res(200, { technicians: techs }) : res(listStatus, { error: "x" }); }
    if (url === "/api/admin/login") return loginResult();
    if (url === "/api/admin/logout") { listStatus = 401; return res(200, { ok: true }); }
    if (url === "/api/admin/technicians" && method === "PUT") return putResult(JSON.parse(init.body));
    if (url === "/api/admin/sync-status") return adminStatusResult();
    if (url === "/api/admin/refresh" && method === "POST") return refreshResult(init);
    return res(404, {});
  };

  const root = createRoot(document.getElementById("root"));
  const text = () => document.body.textContent.replace(/\s+/g, " ").trim();
  const buttons = () => [...document.querySelectorAll("button")];
  const btn = (t) => buttons().find((b) => b.textContent.trim().toLowerCase().startsWith(t.toLowerCase()));
  const click = async (el) => { await act(async () => { el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); }); };
  const type = async (el, v) => { await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new window.Event("input", { bubbles: true })); }); };
  const submit = async () => { await act(async () => { document.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); }); };
  const mod = { exports: {} }; new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  const Page = mod.exports.default;
  const mount = async () => { calls = []; await act(async () => { root.render(React.createElement(React.Fragment, { key: Math.random() }, React.createElement(Page))); }); };
  const rows = () => [...document.querySelectorAll("li")].filter((li) => li.querySelector("button[aria-pressed]"));
  const rowFor = (name) => rows().find((li) => li.textContent.includes(name));
  const letter = (name, L) => [...rowFor(name).querySelectorAll("button[aria-pressed]")].find((b) => b.textContent.trim() === L);

  // 1. switched off
  listStatus = 503; techs = baseTechs(); await mount();
  check("503 -> says admin is switched off and names ADMIN_PASSWORD", /Admin is switched off/.test(text()) && text().includes("ADMIN_PASSWORD"), text());
  check("503 -> no list, no login form", !document.querySelector("form") && rows().length === 0);

  // 2. network failure
  listStatus = -1; await mount();
  check("offline -> friendly error", text().includes("Could not reach the server."), text());

  // 3. signed out -> login
  listStatus = 401; await mount();
  check("401 -> shows the sign-in form", !!document.querySelector("input[type=password]") && /Admin password/i.test(text()));
  check("password field is a real password field with autocomplete", document.querySelector("input").getAttribute("autocomplete") === "current-password");
  check("no technician names leak before sign-in", !text().includes("Drayton"));
  loginResult = () => res(401, { error: "Wrong password." });
  await type(document.querySelector("input"), "nope"); await submit();
  const loginCall = calls.find((c) => c.url === "/api/admin/login");
  check("login posts JSON {password}", loginCall && loginCall.method === "POST" && loginCall.body.password === "nope" && loginCall.headers["content-type"] === "application/json", JSON.stringify(loginCall));
  check("wrong password -> message shown, still on sign-in", text().includes("Wrong password.") && !!document.querySelector("input[type=password]"));
  loginResult = () => res(429, { error: "Too many attempts. Wait a few minutes and try again." });
  await submit(); check("lockout message shown", text().includes("Too many attempts."), text());
  loginResult = () => { throw new Error("offline"); };
  await submit(); check("network failure on sign-in -> friendly message", text().includes("Could not reach the server."), text());

  // 4. successful sign-in -> list
  loginResult = () => { listStatus = 200; return res(200, { ok: true }); };
  await submit();
  check("sign-in success loads the technician list", rows().length === 5 && text().includes("Who takes which calls"), text());
  check("password field cleared/removed after sign-in", !document.querySelector("input[type=password]"));

  // 5. list content + ordering + counts
  const order = rows().map((li) => li.querySelector("p").textContent);
  check("field techs first (alphabetical), then other staff", JSON.stringify(order) === JSON.stringify(["Chris Parkman", "Drayton Wilson", "Stoney Wade", "Brooke Macks", "Jasen Burkett"]), JSON.stringify(order));
  check("each row shows the person's HCP role", rowFor("Jasen Burkett").textContent.includes("admin") && rowFor("Drayton Wilson").textContent.includes("field tech"));
  check("counts line is right", text().includes("1 residential · 0 commercial · 1 hybrid · 3 not offered"), text());
  check("legend explains R, C and H", /R\s*Residential\s*—\s*residential calls only/.test(text()) && /C\s*Commercial\s*—\s*commercial calls only/.test(text()) && /H\s*Hybrid\s*—\s*both residential and commercial/.test(text()), text());
  check("exactly three buttons per person", rows().every((li) => li.querySelectorAll("button[aria-pressed]").length === 3));
  check("existing classifications show as pressed", letter("Drayton Wilson", "R").getAttribute("aria-pressed") === "true" && letter("Chris Parkman", "H").getAttribute("aria-pressed") === "true" && letter("Stoney Wade", "R").getAttribute("aria-pressed") === "false");
  check("unclassified person is labeled Not offered", rowFor("Stoney Wade").textContent.includes("Not offered"));
  check("every button has an accessible label", rows().every((li) => [...li.querySelectorAll("button")].every((b) => (b.getAttribute("aria-label") ?? "").length > 5)));

  // 6. classify
  putResult = (b) => res(200, { technician: { id: b.id, classification: b.classification } });
  calls = [];
  await click(letter("Stoney Wade", "C"));
  const put1 = calls.find((c) => c.method === "PUT");
  check("clicking C sends the right request", put1 && put1.url === "/api/admin/technicians" && put1.body.id === "t_a" && put1.body.classification === "commercial" && put1.headers["content-type"] === "application/json", JSON.stringify(put1));
  check("C is now pressed, row says Commercial, counts updated", letter("Stoney Wade", "C").getAttribute("aria-pressed") === "true" && rowFor("Stoney Wade").textContent.includes("Commercial") && text().includes("1 commercial") && text().includes("2 not offered"), text());
  await click(letter("Stoney Wade", "H"));
  check("switching to H replaces C (only one at a time)", letter("Stoney Wade", "H").getAttribute("aria-pressed") === "true" && letter("Stoney Wade", "C").getAttribute("aria-pressed") === "false" && calls.filter((c) => c.method === "PUT").at(-1).body.classification === "hybrid");
  await click(letter("Stoney Wade", "H"));
  check("clicking the pressed one again clears it (sends null)", calls.filter((c) => c.method === "PUT").at(-1).body.classification === null && rowFor("Stoney Wade").textContent.includes("Not offered"));
  await click(letter("Jasen Burkett", "R"));
  check("an admin/office person can be classified too", letter("Jasen Burkett", "R").getAttribute("aria-pressed") === "true");

  // 7. failures revert
  putResult = () => res(500, { error: "Database unavailable." });
  await click(letter("Brooke Macks", "R"));
  check("failed save reverts the button", letter("Brooke Macks", "R").getAttribute("aria-pressed") === "false" && rowFor("Brooke Macks").textContent.includes("Not offered"));
  check("failed save names the person and the reason", text().includes("Brooke Macks: Database unavailable."), text());
  putResult = () => { throw new Error("offline"); };
  await click(letter("Brooke Macks", "C"));
  check("network failure on save also reverts", letter("Brooke Macks", "C").getAttribute("aria-pressed") === "false" && text().includes("Brooke Macks: offline"), text());
  putResult = (b) => res(200, { technician: b });
  await click(letter("Brooke Macks", "C"));
  check("a later successful save clears the error", !text().includes("Brooke Macks: offline") && letter("Brooke Macks", "C").getAttribute("aria-pressed") === "true");

  // 8. session expires mid-edit
  putResult = () => res(401, { error: "Not signed in." });
  await click(letter("Chris Parkman", "R"));
  check("expired session on save -> back to sign-in, list hidden", !!document.querySelector("input[type=password]") && !text().includes("Drayton"), text());

  // 9. sign out
  listStatus = 200; techs = baseTechs(); loginResult = () => res(200, { ok: true });
  await type(document.querySelector("input"), "pw"); await submit();
  calls = []; await click(btn("Sign out"));
  check("sign out calls logout with JSON header and returns to sign-in", calls.some((c) => c.url === "/api/admin/logout" && c.method === "POST" && c.headers["content-type"] === "application/json") && !!document.querySelector("input[type=password]") && !text().includes("Drayton"));

  // 10. empty roster
  listStatus = 200; techs = []; await mount();
  check("no technicians -> tells you to run the HCP sync", text().includes("node scripts/hcp-sync.mjs --write"), text());

  // ================= 11. the "Keeping the schedule fresh" panel =================
  const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
  const clockOf = (isoText) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }).format(new Date(isoText));
  const STATUS = (over = {}) => ({
    state: "ok", message: "Schedule as of 3:26 PM (4 min ago).", timeZone: "America/Chicago", refreshRunning: false,
    autoSync: { enabled: true, everyMinutes: 10, paused: false, nextRunAt: new Date(Date.now() + 6 * 60000).toISOString() },
    timer: { running: false, consecutiveFailures: 0, hoursText: "6:00 AM to 7:00 PM", resumesAt: "6:00 AM" }, timerOffReason: null,
    details: [
      { part: "jobs", lastAttemptAt: iso(4), lastSuccessAt: iso(4), lastError: null, lastErrorDetail: null, lastTrigger: "auto", lastDurationMs: 9100 },
      { part: "events", lastAttemptAt: iso(4), lastSuccessAt: iso(4), lastError: null, lastErrorDetail: null, lastTrigger: "auto", lastDurationMs: 4300 },
    ], ...over });
  const serve = (body, status = 200) => { adminStatusResult = () => ({ ok: status >= 200 && status < 300, status, json: async () => body }); };
  const panel = () => document.querySelector('[data-panel="refresh"]');
  const ptext = () => (panel() ? panel().textContent.replace(/\s+/g, " ").trim() : "");

  listStatus = 200; techs = baseTechs(); serve(STATUS()); await mount();
  check("P1 the panel is on the Admin screen, above 'Who takes which calls'", !!panel() && /Keeping the schedule fresh/.test(ptext()) && document.body.textContent.indexOf("Keeping the schedule fresh") < document.body.textContent.indexOf("Who takes which calls"));
  check("P1 it asked for the status once, on load", calls.filter((c) => c.url === "/api/admin/sync-status").length === 1, JSON.stringify(calls.map((c) => c.url)));
  check("P2 it shows the server's one-line summary, in a calm green box", panel().querySelector('[data-state="ok"]') && /Schedule as of 3:26 PM \(4 min ago\)\./.test(ptext()) && panel().querySelector('[data-state="ok"]').className.includes("green"));
  check("P3 it explains the automatic refresh: how often, which hours, and when the next one is due", /Automatic refresh runs about every 10 minutes, 6:00 AM to 7:00 PM\. Next run at about \d{1,2}:\d{2} [AP]M\./.test(ptext()), ptext());
  const jobsLine = panel().querySelector('[data-part="jobs"]').textContent.replace(/\s+/g, " ");
  check("P4 each part says when it last worked, how long ago, who started it and how long it took", jobsLine.includes(`Jobs and appointments: last refreshed ${clockOf(iso(4))} (4 min ago) by the automatic refresh, in 9.1 s.`), jobsLine);
  check("P4 ...for calendar events too", /Calendar events: last refreshed .* \(4 min ago\) by the automatic refresh, in 4.3 s\./.test(panel().querySelector('[data-part="events"]').textContent.replace(/\s+/g, " ")));

  serve(STATUS({ state: "failing", message: "Updates are failing (the database could not be reached). Showing the schedule as of 3:00 PM.",
    details: [{ part: "jobs", lastAttemptAt: iso(1), lastSuccessAt: iso(31), lastError: "the database could not be reached", lastErrorDetail: "Can't reach database server at ep-steep-leaf.neon.tech:5432", lastTrigger: "auto", lastDurationMs: 800 },
              { part: "events", lastAttemptAt: iso(31), lastSuccessAt: iso(31), lastError: null, lastErrorDetail: null, lastTrigger: "auto", lastDurationMs: 4300 }],
    timer: { running: false, consecutiveFailures: 3, hoursText: "6:00 AM to 7:00 PM", resumesAt: "6:00 AM" } })); await mount();
  check("P5 failing: a red box, the reason, and the fuller detail an admin needs (the host name is allowed HERE, nowhere else)", panel().querySelector('[data-state="failing"]').className.includes("red") && /the latest attempt \(.*\) failed: the database could not be reached/i.test(ptext()) && /ep-steep-leaf\.neon\.tech/.test(ptext()), ptext());
  check("P5 ...and says the automatic attempts are failing", /The last 3 automatic attempts failed\./.test(ptext()));
  check("P5 ...the healthy part shows no failure line", !/Calendar events:.*failed/.test(panel().querySelector('[data-part="events"]').textContent));

  serve(STATUS({ state: "stale", message: "The schedule is 47 minutes old. Updates may be stuck. Showing it as of 2:39 PM." })); await mount();
  check("P6 stale: an amber box", panel().querySelector('[data-state="stale"]').className.includes("amber"));
  serve(STATUS({ state: "paused", message: "Automatic updates are paused until 6:00 AM. Showing the schedule as of 7:02 PM.", autoSync: { enabled: true, everyMinutes: 10, paused: true, nextRunAt: null } })); await mount();
  check("P7 paused overnight: calm, and says when it resumes", /Automatic refresh is paused until 6:00 AM\./.test(ptext()) && !panel().querySelector('[data-state="paused"]').className.includes("red") && !panel().querySelector('[data-state="paused"]').className.includes("amber"));
  serve(STATUS({ state: "unknown", message: "No schedule update has been recorded yet.", details: [], autoSync: { enabled: false, everyMinutes: null, paused: false, nextRunAt: null }, timer: null, timerOffReason: "HCP_API_KEY or DATABASE_URL is not set" })); await mount();
  check("P8 no timer on this server: says so, why, and how to refresh by hand", /Automatic refresh is off on this server \(HCP_API_KEY or DATABASE_URL is not set\)/.test(ptext()) && /Refresh now or runs node scripts\/hcp-sync\.mjs --write/.test(ptext()), ptext());
  check("P8 parts never refreshed say so", /Jobs and appointments: never refreshed\./.test(ptext()) && /Calendar events: never refreshed\./.test(ptext()));
  serve({}, 404); await mount();
  check("P9 if the status can't be read it says so, and Refresh now is still there", /The refresh status could not be read\./.test(ptext()) && !!btn("Refresh now"));
  serve({}, 401); await mount();
  check("P10 a signed-out answer from the status sends you to the sign-in screen", !!document.querySelector("input[type=password]") && !panel());

  // ---- Refresh now
  serve(STATUS()); await mount();
  let release; let refreshInit = null;
  refreshResult = (init) => { refreshInit = init; return new Promise((resolve) => { release = () => resolve({ ok: true, status: 200, json: async () => ({ ok: true, seconds: 9.4, jobsRows: 85, eventsRows: 39, eventsError: null, statusRecorded: true }) }); }); };
  calls = [];
  await act(async () => { btn("Refresh now").dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
  check("R1 pressing it sends a JSON POST (the server refuses anything else)", !!refreshInit && refreshInit.method === "POST" && refreshInit.headers["content-type"] === "application/json" && refreshInit.body === "{}");
  check("R2 while it runs the button says Refreshing and cannot be pressed twice", /Refreshing/.test(btn("Refreshing").textContent) && btn("Refreshing").disabled === true);
  await act(async () => { release(); await new Promise((r2) => setTimeout(r2, 5)); });
  check("R3 when done it reports the result in plain words", /Done in 9\.4 seconds: 85 job rows, 39 event rows\./.test(ptext()), ptext());
  check("R4 ...and re-reads the status so the panel shows the new times", calls.filter((c) => c.url === "/api/admin/sync-status").length === 1, JSON.stringify(calls.map((c) => c.url)));
  check("R5 the button is usable again", !!btn("Refresh now") && btn("Refresh now").disabled === false);

  const answer = (status, body) => { refreshResult = () => ({ ok: status >= 200 && status < 300, status, json: async () => body }); };
  answer(200, { ok: true, seconds: 8.2, jobsRows: 85, eventsRows: null, eventsError: "Housecall Pro is limiting how often we can ask", statusRecorded: true });
  await click(btn("Refresh now")); await act(async () => { await new Promise((r2) => setTimeout(r2, 5)); });
  check("R6 events failing inside a refresh is reported, and the job part still counts as done", /Done in 8\.2 seconds: 85 job rows\./.test(ptext()) && /Calendar events could not be refreshed: Housecall Pro is limiting how often we can ask\./.test(ptext()), ptext());
  answer(200, { ok: true, seconds: 8.2, jobsRows: 85, eventsRows: 39, eventsError: null, statusRecorded: false });
  await click(btn("Refresh now")); await act(async () => { await new Promise((r2) => setTimeout(r2, 5)); });
  check("R7 if the status could not be saved it says to run the migration", /has the database migration been run\?/.test(ptext()), ptext());
  answer(409, { error: "A refresh is already running. Try again in a moment." });
  await click(btn("Refresh now")); await act(async () => { await new Promise((r2) => setTimeout(r2, 5)); });
  check("R8 'already running' is passed on kindly", /A refresh is already running\. Try again in a moment\./.test(ptext()));
  answer(500, { error: "The refresh failed: the database could not be reached." });
  await click(btn("Refresh now")); await act(async () => { await new Promise((r2) => setTimeout(r2, 5)); });
  check("R9 a failed refresh shows the short reason (never the host name)", /The refresh failed: the database could not be reached\./.test(ptext()) && !/neon\.tech/.test(ptext().replace(/ep-steep-leaf\.neon\.tech:5432/g, "")), ptext());
  refreshResult = () => { throw new Error("offline"); };
  await click(btn("Refresh now")); await act(async () => { await new Promise((r2) => setTimeout(r2, 5)); });
  check("R10 no connection: a friendly message", /Could not reach the server\./.test(ptext()));
  answer(401, { error: "Not signed in." });
  await click(btn("Refresh now")); await act(async () => { await new Promise((r2) => setTimeout(r2, 5)); });
  check("R11 if the sign-in expired mid-click you are sent back to sign in", !!document.querySelector("input[type=password]"));

  // ---- a refresh already running when the page opens, and coming back to the tab
  serve(STATUS({ refreshRunning: true })); await mount();
  check("R12 if a refresh is already running (the timer started one) the button shows Refreshing and is disabled", !!btn("Refreshing") && btn("Refreshing").disabled === true);
  serve(STATUS()); calls = [];
  await act(async () => { window.dispatchEvent(new window.Event("focus")); await new Promise((r2) => setTimeout(r2, 5)); });
  check("R13 coming back to the tab re-reads the status (no timer polling the database)", calls.filter((c) => c.url === "/api/admin/sync-status").length === 1 && !!btn("Refresh now"), JSON.stringify(calls.map((c) => c.url)));

  await act(async () => { root.unmount(); });
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(2); });
