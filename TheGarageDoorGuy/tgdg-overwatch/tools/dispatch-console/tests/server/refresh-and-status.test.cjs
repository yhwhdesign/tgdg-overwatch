const esbuild = require("esbuild");
const path = require("path");
const TMP = path.join(__dirname, "..", ".tmp");
require("fs").mkdirSync(TMP, { recursive: true });

const fs = require("fs");
const SRC = path.join(__dirname, "../../src");
const NEXT = path.join(__dirname, "../../node_modules/next/server.js");
let passes = 0, failures = 0;
const check = (name, ok, detail = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${name}${detail ? "  <- " + detail : ""}`); } };

// ---- fakes: an in-memory database and a fake Housecall Pro, shared through globalThis
const fakePrisma = path.join(TMP, "fake-prisma-refresh.cjs");
const fakeHcp = path.join(TMP, "fake-hcp-refresh.cjs");
fs.writeFileSync(fakePrisma, `
  const match = (row, where) => Object.entries(where).every(([k, c]) => { const v = row[k];
    if (c && typeof c === "object" && !(c instanceof Date)) { if ("startsWith" in c) return typeof v === "string" && v.startsWith(c.startsWith); if ("notIn" in c) return !c.notIn.includes(v); if ("lt" in c) return v < c.lt; if ("gte" in c || "lte" in c) return (!("gte" in c) || v >= c.gte) && (!("lte" in c) || v <= c.lte); }
    return v === c; });
  const D = () => globalThis.__DB;
  module.exports.prisma = {
    technician: {
      async findMany(a) { return D().techs.filter((r) => match(r, (a && a.where) || {})).map((r) => ({ ...r })); },
      async upsert(a) { const ex = D().techs.find((r) => r.hcpEmployeeId === a.where.hcpEmployeeId); if (ex) Object.assign(ex, a.update); else D().techs.push({ id: "t" + (D().techs.length + 1), classification: null, ...a.create }); },
      async updateMany() { return { count: 0 }; },
    },
    appointment: {
      async upsert(a) { const k = a.where.hcpJobId_technicianId; const ex = D().appts.find((r) => r.hcpJobId === k.hcpJobId && r.technicianId === k.technicianId); if (ex) Object.assign(ex, a.update); else D().appts.push({ ...a.create }); },
      async deleteMany(a) { const b = D().appts.length; D().appts = D().appts.filter((r) => !match(r, a.where)); return { count: b - D().appts.length }; },
      async count(a) { return D().appts.filter((r) => match(r, a.where)).length; },
    },
    syncStatus: {
      async upsert(a) { if (D().statusWriteFails) throw new Error("relation \\"SyncStatus\\" does not exist"); const k = a.where.key; const ex = D().status.find((r) => r.key === k); if (ex) Object.assign(ex, a.update); else D().status.push({ ...a.create }); },
      async findMany() { D().statusReads++; if (D().statusReadFails) throw new Error("Can't reach database server at ep-secret-host.neon.tech"); return D().status.map((r) => ({ ...r })); },
    },
    webhookEvent: {},
  };`);
fs.writeFileSync(fakeHcp, `
  module.exports.hcpApi = {
    async listEmployees() { if (globalThis.__HCP.employeesError) throw new Error(globalThis.__HCP.employeesError); return globalThis.__HCP.employees; },
    async *listJobsInWindow() { yield { jobs: globalThis.__HCP.jobs, page: 1, totalPages: 1, totalItems: globalThis.__HCP.jobs.length }; },
    async getJob() { return null; },
    async listAppointments() { return []; },
    async listEvents() { if (globalThis.__HCP.delayMs) await new Promise((r) => setTimeout(r, globalThis.__HCP.delayMs)); globalThis.__HCP.eventsCalls++; if (globalThis.__HCP.eventsError) throw new Error(globalThis.__HCP.eventsError); return globalThis.__HCP.events; },
  };`);

async function bundle(entryContents, name) {
  const entry = path.join(TMP, `entry-${name}.ts`);
  fs.writeFileSync(entry, entryContents);
  const out = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false, format: "cjs", platform: "node", alias: { "@": SRC }, external: ["next/server", "node:crypto"], logLevel: "silent",
    plugins: [{ name: "fakes", setup(b) { b.onResolve({ filter: /^@\/lib\/prisma$/ }, () => ({ path: fakePrisma })); b.onResolve({ filter: /^@\/lib\/hcp-client$/ }, () => ({ path: fakeHcp })); } }],
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, (id) => require(id === "next/server" ? NEXT : id));
  return mod.exports;
}

const DRAY = "pro_" + "d".repeat(32);
const tomorrow = (h) => { const d = new Date(Date.now() + 86400000); d.setUTCHours(h + 5, 0, 0, 0); return d.toISOString(); };
const reset = () => {
  globalThis.__DB = { techs: [], appts: [], status: [], statusReads: 0, statusWriteFails: false, statusReadFails: false };
  globalThis.__HCP = {
    employees: [{ id: DRAY, first_name: "Drayton", last_name: "Wilson", role: "field tech" }],
    jobs: [{ id: "job_" + "1".repeat(32), work_status: "scheduled", schedule: { scheduled_start: tomorrow(9), scheduled_end: tomorrow(11) }, assigned_employees: [{ id: DRAY }], address: { zip: "72201" } }],
    events: [{ id: "evt_1", name: "Pick up product", start_time: tomorrow(7), end_time: tomorrow(8), assigned_employees: [{ id: DRAY }] }],
    employeesError: null, eventsError: null, delayMs: 0, eventsCalls: 0,
  };
  delete globalThis.__tgdgSyncRunning; delete globalThis.__tgdgStatusCache;
};
const statusOf = (key) => globalThis.__DB.status.find((r) => r.key === key);

(async () => {
  process.env.ADMIN_PASSWORD = "pw-for-tests"; process.env.ADMIN_SYNC_SECRET = "s3cret"; process.env.BUSINESS_TIMEZONE = "America/Chicago";
  const lib = await bundle(`export * from "@/lib/run-sync"; export * from "@/lib/sync-status-store"; export * from "@/lib/auto-sync"; export { createSessionValue } from "@/lib/admin-session"; export { syncWindow } from "@/lib/availability";`, "lib");
  const cookie = `overwatch_admin=${lib.createSessionValue("pw-for-tests")}`;
  const { NextRequest } = require(NEXT);
  const deps = (over = {}) => ({ db: require(fakePrisma).prisma, hcp: require(fakeHcp).hcpApi, now: () => new Date(), window: lib.syncWindow, timeZone: "America/Chicago", ...over });

  // ================= A. runSync records what happened =================
  reset();
  let logs = [];
  let r = await lib.runSync(deps(), { dryRun: false, trigger: "auto", log: (m) => logs.push(m) });
  check("A1 a successful refresh records BOTH parts as succeeded, with the trigger", ["jobs", "events"].every((k) => statusOf(k) && statusOf(k).lastSuccessAt instanceof Date && statusOf(k).lastError === null && statusOf(k).lastTrigger === "auto"), JSON.stringify(globalThis.__DB.status));
  check("A1 ...and it really wrote the data (a job row and an event row)", globalThis.__DB.appts.length === 2 && r.statusRecorded === true);
  check("A1 durations are recorded as numbers", typeof statusOf("jobs").lastDurationMs === "number" && statusOf("jobs").lastDurationMs >= 0);

  reset();
  await lib.runSync(deps(), { dryRun: true, trigger: "manual" });
  check("A2 a DRY RUN records nothing (it changed nothing, so it must not make the data look fresh)", globalThis.__DB.status.length === 0 && globalThis.__DB.appts.length === 0);

  reset(); globalThis.__HCP.eventsError = "HCP would not list events: HTTP 500";
  r = await lib.runSync(deps(), { dryRun: false, trigger: "auto" });
  check("A3 events failing: the job sync still completes and is recorded as a success", statusOf("jobs").lastSuccessAt instanceof Date && statusOf("jobs").lastError === null && globalThis.__DB.appts.length === 1);
  check("A3 ...the events part is recorded as FAILED with a safe category, and no success time", statusOf("events").lastSuccessAt === null && /Housecall Pro had a problem on its side/.test(statusOf("events").lastError) && /HTTP 500/.test(statusOf("events").lastErrorDetail), JSON.stringify(statusOf("events")));
  check("A3 ...and the result still carries the events error for the caller", /HTTP 500/.test(r.events.error));

  // a failure after an earlier success keeps the earlier success time
  reset();
  await lib.runSync(deps(), { dryRun: false, trigger: "auto" });
  const firstSuccess = statusOf("jobs").lastSuccessAt.getTime();
  await new Promise((res) => setTimeout(res, 15));
  globalThis.__HCP.employeesError = "getaddrinfo ENOTFOUND api.housecallpro.com";
  let threw = null; try { await lib.runSync(deps(), { dryRun: false, trigger: "auto" }); } catch (e) { threw = e; }
  check("A4 a jobs failure is rethrown to the caller", !!threw && /ENOTFOUND/.test(threw.message));
  check("A4 ...recorded with a safe category, and the earlier success time is KEPT", statusOf("jobs").lastSuccessAt.getTime() === firstSuccess && /could not be reached/.test(statusOf("jobs").lastError) && statusOf("jobs").lastAttemptAt.getTime() > firstSuccess, JSON.stringify(statusOf("jobs")));
  check("A4 ...and the events part is left alone (it was not attempted)", statusOf("events").lastError === null);

  reset(); globalThis.__DB.statusWriteFails = true; logs = [];
  r = await lib.runSync(deps(), { dryRun: false, trigger: "manual", log: (m) => logs.push(m) });
  check("A5 if the status table can't be written (migration not run) the sync STILL works and says so", r.statusRecorded === false && globalThis.__DB.appts.length === 2 && logs.some((l) => /has the database migration been run/.test(l)), logs.join(" | "));

  reset(); await lib.getFreshness().catch(() => null); const before = globalThis.__tgdgStatusCache;
  await lib.runSync(deps(), { dryRun: false, trigger: "manual" });
  check("A6 a refresh forgets the cached status so the next look is current", before !== undefined && globalThis.__tgdgStatusCache === undefined);

  // ================= B. one refresh at a time =================
  reset(); globalThis.__HCP.delayMs = 150;
  const first = lib.runFullSync({ dryRun: false, trigger: "auto" });
  await new Promise((res) => setTimeout(res, 20));
  check("B1 while a refresh runs, the lock says so", lib.isSyncRunning() === true);
  let busy = null; try { await lib.runFullSync({ dryRun: false, trigger: "manual" }); } catch (e) { busy = e; }
  check("B2 a second refresh is refused with SyncBusyError (not queued, not run twice)", !!busy && busy.code === "SYNC_BUSY" && busy instanceof lib.SyncBusyError);
  await first;
  check("B3 after it finishes the lock is released and the events were fetched exactly once", lib.isSyncRunning() === false && globalThis.__HCP.eventsCalls === 1, String(globalThis.__HCP.eventsCalls));
  reset(); globalThis.__HCP.employeesError = "boom";
  await lib.runFullSync({ dryRun: false, trigger: "auto" }).catch(() => {});
  check("B4 a FAILED refresh also releases the lock", lib.isSyncRunning() === false);

  // ================= C. the public status route =================
  const publicRoute = await bundle(`export { GET } from "@/app/api/sync-status/route";`, "publicstatus");
  reset();
  await lib.runFullSync({ dryRun: false, trigger: "auto" });
  let res = await publicRoute.GET();
  let body = await res.json();
  check("C1 returns the freshness report with state, as-of, age and a message", res.status === 200 && body.state === "ok" && typeof body.asOf === "string" && body.ageMinutes === 0 && /^Schedule as of .+ \(just now\)\.$/.test(body.message), JSON.stringify(body).slice(0, 300));
  check("C1 ...and tells the browser not to cache it", res.headers.get("cache-control") === "no-store");
  check("C2 it reports each part", body.parts.map((p) => p.part).join() === "jobs,events" && body.parts.every((p) => p.state === "ok"));
  const reads = globalThis.__DB.statusReads;
  for (let i = 0; i < 5; i++) await publicRoute.GET();
  check("C3 repeated looks are answered from memory: the database is NOT touched again (protects the free plan's sleep)", globalThis.__DB.statusReads === reads, `${globalThis.__DB.statusReads - reads} extra reads`);
  await lib.runFullSync({ dryRun: false, trigger: "manual" });
  await publicRoute.GET();
  check("C4 after a refresh the next look reads the database once to pick up the new times", globalThis.__DB.statusReads === reads + 1, String(globalThis.__DB.statusReads - reads));

  reset(); await lib.runSync(deps(), { dryRun: false, trigger: "auto" });
  globalThis.__DB.status.find((r) => r.key === "events").lastError = "the database could not be reached"; globalThis.__DB.status.find((r) => r.key === "events").lastErrorDetail = "Can't reach ep-secret-host.neon.tech"; globalThis.__DB.status.find((r) => r.key === "events").lastAttemptAt = new Date(Date.now() + 1000);
  delete globalThis.__tgdgStatusCache;
  res = await publicRoute.GET(); body = await res.json();
  check("C5 the PUBLIC route never carries the host name or the admin-only detail", !/neon\.tech|ep-secret|lastErrorDetail/.test(JSON.stringify(body)), JSON.stringify(body).slice(0, 200));

  reset(); globalThis.__DB.statusReadFails = true;
  res = await publicRoute.GET(); body = await res.json();
  check("C6 if the database is unreachable the route answers 503 with a generic message (no host name)", res.status === 503 && body.error === "Could not read the update status." && !/neon|ep-secret/.test(JSON.stringify(body)), JSON.stringify(body));
  reset(); res = await publicRoute.GET(); body = await res.json();
  check("C7 before any refresh has ever run it says 'unknown', not an error", res.status === 200 && body.state === "unknown" && /No schedule update/.test(body.message));

  // ================= D. the admin routes =================
  const adminStatus = await bundle(`export { GET } from "@/app/api/admin/sync-status/route";`, "adminstatus");
  const refresh = await bundle(`export { POST } from "@/app/api/admin/refresh/route";`, "refresh");
  const req = (method, withCookie = true, json = true) => new NextRequest("http://localhost:3000/x", { method, headers: { ...(withCookie ? { cookie } : {}), ...(json ? { "content-type": "application/json" } : {}) } });

  reset();
  check("D1 the admin status needs the sign-in", (await adminStatus.GET(req("GET", false))).status === 401);
  check("D2 the refresh needs the sign-in", (await refresh.POST(req("POST", false))).status === 401);
  check("D3 the refresh refuses a non-JSON request (cross-site form protection)", (await refresh.POST(req("POST", true, false))).status === 415);
  const savedPw = process.env.ADMIN_PASSWORD; delete process.env.ADMIN_PASSWORD;
  check("D4 with no ADMIN_PASSWORD configured the admin routes are off (503)", (await adminStatus.GET(req("GET"))).status === 503 && (await refresh.POST(req("POST"))).status === 503);
  process.env.ADMIN_PASSWORD = savedPw;

  reset();
  res = await refresh.POST(req("POST")); body = await res.json();
  check("D5 Refresh now runs the whole refresh and reports a short summary", res.status === 200 && body.ok === true && body.jobsRows === 1 && body.eventsRows === 1 && body.eventsError === null && body.statusRecorded === true && typeof body.seconds === "number", JSON.stringify(body));
  check("D5 ...and it is recorded as a MANUAL refresh", statusOf("jobs").lastTrigger === "manual" && statusOf("events").lastTrigger === "manual");

  reset(); globalThis.__HCP.delayMs = 150;
  const slow = refresh.POST(req("POST"));
  await new Promise((r2) => setTimeout(r2, 20));
  res = await refresh.POST(req("POST")); body = await res.json();
  check("D6 pressing it while a refresh is running answers 409 with a friendly message", res.status === 409 && /already running/.test(body.error), JSON.stringify(body));
  await slow;

  reset(); globalThis.__HCP.employeesError = "Can't reach database server at `ep-secret-host.neon.tech:5432`";
  res = await refresh.POST(req("POST")); body = await res.json();
  check("D7 a failed refresh answers 500 with only the safe category (no host name)", res.status === 500 && /the database could not be reached/.test(body.error) && !/neon|ep-secret/.test(JSON.stringify(body)), JSON.stringify(body));

  reset(); globalThis.__HCP.eventsError = "HCP API error 429 on /events";
  res = await refresh.POST(req("POST")); body = await res.json();
  check("D8 events failing is reported as part of a successful refresh, with a safe category", res.status === 200 && body.eventsRows === null && /limiting how often/.test(body.eventsError), JSON.stringify(body));

  reset(); await lib.runSync(deps(), { dryRun: false, trigger: "auto" });
  globalThis.__DB.status[1].lastError = "the database could not be reached"; globalThis.__DB.status[1].lastErrorDetail = "Can't reach ep-secret-host.neon.tech"; globalThis.__DB.status[1].lastAttemptAt = new Date(Date.now() + 1000);
  res = await adminStatus.GET(req("GET")); body = await res.json();
  check("D9 the ADMIN status does include the fuller detail, and never uses the cache", res.status === 200 && body.details.find((d) => d.part === "events").lastErrorDetail.includes("ep-secret-host") && Array.isArray(body.details) && body.refreshRunning === false);
  check("D9 ...and says there is no timer on this server unless one was started", body.timer === null && typeof body.timerOffReason === "string");

  // ================= E. the existing secret-protected route uses the same runner =================
  const hcpSync = await bundle(`export { POST } from "@/app/api/admin/hcp-sync/route";`, "hcpsync");
  const post = (qs, secret = "s3cret") => hcpSync.POST(new NextRequest(`http://localhost:3000/api/admin/hcp-sync?${qs}`, { method: "POST", headers: { "x-admin-secret": secret } }));
  reset();
  res = await post("dryRun=1"); body = await res.json();
  check("E1 dry run: full report, nothing recorded", res.status === 200 && body.jobs.appointmentRows === 1 && body.events.rows === 1 && globalThis.__DB.status.length === 0);
  res = await post("dryRun=0"); body = await res.json();
  check("E2 a real run through the script's route is recorded too", res.status === 200 && body.statusRecorded === true && statusOf("jobs").lastTrigger === "manual");
  reset(); globalThis.__HCP.delayMs = 150;
  const slow2 = post("dryRun=0"); await new Promise((r2) => setTimeout(r2, 20));
  res = await post("dryRun=0");
  check("E3 the script's route also refuses while a refresh is running (409)", res.status === 409);
  await slow2;
  check("E4 wrong secret still refused", (await post("dryRun=1", "nope")).status === 403);

  // ================= F. the timer, started for real with a fast test setting =================
  reset();
  const noKey = lib.startAutoSync({ AUTO_SYNC_MINUTES: "10" });
  check("F1 without HCP_API_KEY and DATABASE_URL the timer stays off and says why", noKey === undefined && lib.getAutoSyncInfo() === null && /not set/.test(lib.autoSyncOffReason() ?? ""), String(lib.autoSyncOffReason()));
  delete globalThis.__tgdgAutoSyncOff;
  lib.startAutoSync({ AUTO_SYNC_MINUTES: "0", HCP_API_KEY: "k", DATABASE_URL: "d" });
  check("F2 AUTO_SYNC_MINUTES=0 keeps it off", lib.getAutoSyncInfo() === null && /off/.test(lib.autoSyncOffReason() ?? ""));
  delete globalThis.__tgdgAutoSyncOff;
  const log = console.log; const lines = []; console.log = (...a) => lines.push(a.join(" "));
  lib.startAutoSync({ AUTO_SYNC_MINUTES: "0.05", AUTO_SYNC_ALLOW_FAST: "1", AUTO_SYNC_HOURS: "0-24", AUTO_SYNC_STARTUP_DELAY_SECONDS: "0.2", HCP_API_KEY: "k", DATABASE_URL: "d" });
  const info = lib.getAutoSyncInfo();
  check("F3 started: the status screens can see the timer's settings", !!info && info.enabled === true && info.everyMinutes === 0.05 && info.paused === false, JSON.stringify(info));
  const dup = Object.keys(globalThis).includes("__tgdgAutoSync");
  lib.startAutoSync({ AUTO_SYNC_MINUTES: "0.05", AUTO_SYNC_ALLOW_FAST: "1", AUTO_SYNC_HOURS: "0-24", HCP_API_KEY: "k", DATABASE_URL: "d" });
  await new Promise((res2) => setTimeout(res2, 4500));
  console.log = log;
  const okLines = lines.filter((l) => /\[auto-sync\] ok in/.test(l));
  check("F4 with no one pressing anything it refreshed by itself, more than once (startup, then on the interval)", okLines.length >= 2, `${okLines.length}: ${lines.join(" | ")}`);
  check("F5 starting it twice did NOT make two timers (one 'on:' line only)", lines.filter((l) => /\[auto-sync\] on:/.test(l)).length === 1, lines.filter((l) => /on:/.test(l)).join(" | "));
  check("F6 each automatic refresh was recorded, and the last trigger is 'auto'", statusOf("jobs") && statusOf("events") && statusOf("jobs").lastTrigger === "auto" && statusOf("jobs").lastSuccessAt instanceof Date, JSON.stringify(statusOf("jobs")));
  check("F7 the log line gives rows, not data: no names, ids or addresses", okLines.every((l) => /jobs \d+ rows, events \d+/.test(l)) && !lines.some((l) => /Drayton|pro_|72201/.test(l)), okLines.join(" | "));
  const state = lib.getAutoSyncState();
  check("F8 the controller's state shows the next run time and a consistent trigger", state.nextRunAt instanceof Date && state.consecutiveFailures === 0 && ["startup", "auto"].includes(state.lastTrigger), JSON.stringify(state));

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(2); });
