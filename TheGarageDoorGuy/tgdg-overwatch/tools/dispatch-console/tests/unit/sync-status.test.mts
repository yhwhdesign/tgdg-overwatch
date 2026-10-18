// @ts-nocheck
import { describeSyncError, recordPartOutcome, computeFreshness, staleAfterMinutes, type StatusDb, type SyncStatusRow, type AutoSyncInfo } from "../../src/lib/sync-status.ts";
let passes = 0, failures = 0;
const check = (n: string, ok: boolean, d = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${n}${d ? "  <- " + d : ""}`); } };
const eq = (n: string, a: unknown, b: unknown) => check(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);

// ================= A. error descriptions =================
{
  const cat = (e: unknown) => describeSyncError(e).category;
  const dbErr = Object.assign(new Error("Can't reach database server at `ep-steep-leaf-b4hu9c6g-pooler.c-6.us-east-2.aws.neon.tech:5432`"), { code: "P1001" });
  eq("A1 an unreachable database", cat(dbErr), "the database could not be reached");
  check("A1 ...and the safe category never contains the host name, but the admin detail does", !/neon\.tech|ep-steep/.test(cat(dbErr)) && /neon\.tech/.test(describeSyncError(dbErr).detail));
  eq("A2 database error recognized by text alone", cat(new Error("Invalid `prisma.x()` invocation: Can't reach database server")), "the database could not be reached");
  eq("A3 HCP rejected the key", cat(new Error("HCP rejected the API key with both header styles.")), "Housecall Pro rejected the key");
  eq("A3 HCP 401 on a call", cat(new Error("HCP API error 401 on /jobs: nope")), "Housecall Pro rejected the key");
  eq("A4 rate limited", cat(new Error("HCP API error 429 on /jobs")), "Housecall Pro is limiting how often we can ask");
  eq("A5 took too long", cat(new Error("reading events took longer than 150 seconds (read 4 of 39 pages)")), "reading Housecall Pro took too long");
  eq("A6 no internet", cat(new TypeError("fetch failed")), "Housecall Pro could not be reached (check the internet connection)");
  eq("A6 DNS failure", cat(new Error("getaddrinfo ENOTFOUND api.housecallpro.com")), "Housecall Pro could not be reached (check the internet connection)");
  eq("A7 HCP server error", cat(new Error("HCP API error 503 on /events: down")), "Housecall Pro had a problem on its side");
  eq("A8 anything else", cat(new Error("kaboom")), "an unexpected error (see the server log)");
  eq("A8 a thrown string", cat("oops"), "an unexpected error (see the server log)");
  const long = describeSyncError(new Error("x".repeat(1000) + "\n  \n spaced   out"));
  check("A9 the detail is cut to 300 characters and whitespace collapsed", long.detail.length === 300 && !/\s{2}/.test(long.detail), String(long.detail.length));
  check("A10 no safe category ever contains a key, id, or the word 'secret'", ["pro_" + "a".repeat(32), "job_" + "b".repeat(32), "secret"].every((needle) => !cat(new Error(`HCP API error 500: ${needle}`)).includes(needle)));
}

// ================= B. recording =================
function fakeStatusDb() {
  const rows: Record<string, any> = {};
  const db: StatusDb = {
    syncStatus: {
      async upsert(a: any) { const k = a.where.key; rows[k] = rows[k] ? { ...rows[k], ...a.update } : { ...a.create }; return rows[k]; },
      async findMany() { return Object.values(rows) as SyncStatusRow[]; },
    },
  };
  return { db, rows };
}
{
  const { db, rows } = fakeStatusDb();
  const t = (min: number) => new Date(Date.UTC(2026, 9, 11, 20, min));
  await recordPartOutcome(db, { part: "jobs", ok: true, startedAt: t(0), finishedAt: new Date(t(0).getTime() + 9100), trigger: "auto" });
  eq("B1 a success creates the row with times, trigger and duration", [rows.jobs.lastSuccessAt.toISOString(), rows.jobs.lastError, rows.jobs.lastTrigger, rows.jobs.lastDurationMs], [new Date(t(0).getTime() + 9100).toISOString(), null, "auto", 9100]);
  await recordPartOutcome(db, { part: "jobs", ok: false, startedAt: t(10), finishedAt: t(10), trigger: "auto", error: Object.assign(new Error("Can't reach database server"), { code: "P1001" }) });
  check("B2 a failure records the attempt and the reason but KEEPS the last success time", rows.jobs.lastSuccessAt.getTime() === new Date(t(0).getTime() + 9100).getTime() && rows.jobs.lastAttemptAt.getTime() === t(10).getTime() && rows.jobs.lastError === "the database could not be reached" && /Can't reach/.test(rows.jobs.lastErrorDetail));
  await recordPartOutcome(db, { part: "jobs", ok: true, startedAt: t(20), finishedAt: t(20), trigger: "manual" });
  check("B3 the next success clears the error", rows.jobs.lastError === null && rows.jobs.lastErrorDetail === null && rows.jobs.lastTrigger === "manual");
  await recordPartOutcome(db, { part: "events", ok: false, startedAt: t(0), finishedAt: t(0), trigger: "startup", error: new Error("kaboom") });
  check("B4 a part that has NEVER succeeded has no success time", rows.events.lastSuccessAt === null && rows.events.lastError === "an unexpected error (see the server log)");
  await recordPartOutcome(db, { part: "events", ok: true, startedAt: new Date(t(5).getTime() + 4000), finishedAt: t(5), trigger: "auto" });
  eq("B5 a duration can never be negative", rows.events.lastDurationMs, 0);
}

// ================= C. freshness =================
const NOW = new Date("2026-10-11T20:30:00Z");                       // 3:30 PM Chicago
const ago = (min: number) => new Date(NOW.getTime() - min * 60000);
const row = (key: string, successMin: number | null, extra: Partial<SyncStatusRow> = {}): SyncStatusRow => ({ key, lastAttemptAt: successMin === null ? ago(5) : ago(successMin), lastSuccessAt: successMin === null ? null : ago(successMin), lastError: null, lastErrorDetail: null, lastTrigger: "auto", lastDurationMs: 9000, ...extra });
const AUTO: AutoSyncInfo = { enabled: true, everyMinutes: 10, paused: false, resumesAt: null, nextRunAt: new Date(NOW.getTime() + 6 * 60000) };
const fresh = (rows: SyncStatusRow[], auto: AutoSyncInfo | null = AUTO, override: number | null = null) => computeFreshness({ rows, now: NOW, timeZone: "America/Chicago", auto, staleAfterOverrideMinutes: override });
{
  let r = fresh([row("jobs", 4), row("events", 4)]);
  eq("C1 both parts recent: ok, with the time and the age", [r.state, r.ageMinutes, r.message], ["ok", 4, "Schedule as of 3:26 PM (4 min ago)."]);
  eq("C1 the as-of time is also given as clock text in the business time zone, with the zone", [r.asOfText, r.timeZone], ["3:26 PM", "America/Chicago"]);
  r = fresh([row("jobs", 4), row("events", 40)]);
  eq("C2 the schedule is only as fresh as its STALEST part: events 40 min old -> stale, as of the events time", [r.state, r.ageMinutes, r.parts.map((p) => p.state)], ["stale", 40, ["ok", "stale"]]);
  check("C2 the message says how old and when", /40 minutes old/.test(r.message) && /2:50 PM/.test(r.message), r.message);
  r = fresh([row("jobs", 30, { lastAttemptAt: ago(2), lastError: "the database could not be reached" }), row("events", 30)]);
  check("C3 old data AND a failed latest attempt: failing, with the reason and the as-of time", r.state === "failing" && /the database could not be reached/.test(r.message) && /3:00 PM/.test(r.message), r.message);
  r = fresh([row("jobs", 8, { lastAttemptAt: ago(1), lastError: "the database could not be reached" }), row("events", 8)]);
  eq("C4 one failed attempt right after a recent success is NOT an alarm yet (it will retry)", r.state, "ok");
  r = fresh([row("jobs", 16, { lastAttemptAt: ago(1), lastError: "Housecall Pro had a problem on its side" }), row("events", 16)]);
  eq("C4b ...but a failure that has gone more than 1.5 intervals is failing, before it is merely 'stale'", r.state, "failing");
  r = fresh([]);
  eq("C5 nothing recorded yet: unknown", [r.state, r.message, r.asOf], ["unknown", "No schedule update has been recorded yet.", null]);
  r = fresh([row("jobs", 4)]);
  check("C6 only one part recorded: unknown, and it says which part", r.state === "unknown" && /events part/.test(r.message), r.message);
  r = fresh([row("jobs", 600), row("events", 600)], { ...AUTO, paused: true, resumesAt: "6:00 AM" });
  check("C7 outside the refresh hours: 'paused', not an alarm, with when it resumes", r.state === "paused" && /paused until 6:00 AM/.test(r.message) && /as of 5:30 AM/.test(r.message), r.message);
  r = fresh([row("jobs", 25), row("events", 25)], null);
  eq("C8 with no automatic refresh, 30 minutes is the limit: 25 min is ok", r.state, "ok");
  r = fresh([row("jobs", 31), row("events", 31)], null);
  eq("C8 ...and 31 minutes is stale", r.state, "stale");
  r = fresh([row("jobs", 25), row("events", 25)], AUTO);
  eq("C9 with refresh every 10 minutes the limit is 22: 25 min is stale", [r.staleAfterMinutes, r.state], [22, "stale"]);
  r = fresh([row("jobs", 12), row("events", 12)], AUTO, 5);
  eq("C10 an explicit limit (STALE_AFTER_MINUTES) wins", [r.staleAfterMinutes, r.state], [5, "stale"]);
  eq("C11 the limit never drops below 15 minutes, even for a fast refresh", staleAfterMinutes({ ...AUTO, everyMinutes: 5 }), 15);
  r = fresh([row("jobs", 0), row("events", 0)]);
  eq("C12 'just now'", r.message, "Schedule as of 3:30 PM (just now).");
  r = fresh([row("jobs", 75), row("events", 75)], null, 200);
  eq("C13 an hour and a bit", r.message, "Schedule as of 2:15 PM (1 hr 15 min ago).");
  r = fresh([row("jobs", 120), row("events", 120)], null, 200);
  eq("C13 exactly two hours", r.message, "Schedule as of 1:30 PM (2 hr ago).");
  const skew = fresh([{ ...row("jobs", 0), lastSuccessAt: new Date(NOW.getTime() + 5 * 60000) }, row("events", 0)]);
  eq("C14 a success time in the future (clock skew) is treated as age 0, never negative", skew.parts[0].ageMinutes, 0);
  r = fresh([row("jobs", 4, { lastError: "old", lastAttemptAt: ago(4) }), row("events", 4)]);
  eq("C15 a leftover error text with no LATER failed attempt does not make it failing", r.state, "ok");
  r = fresh([row("jobs", 4), row("events", 4)]);
  eq("C16 the auto-refresh settings are passed along for the screen", r.autoSync, { enabled: true, everyMinutes: 10, paused: false, nextRunAt: new Date(NOW.getTime() + 6 * 60000).toISOString() });
  r = fresh([row("jobs", 4), row("events", 4)], null);
  eq("C17 with no automatic refresh it says so", r.autoSync, { enabled: false, everyMinutes: null, paused: false, nextRunAt: null });
  const json = JSON.stringify(fresh([row("jobs", 30, { lastAttemptAt: ago(2), lastError: "the database could not be reached", lastErrorDetail: "Can't reach ep-steep-leaf.neon.tech" }), row("events", 30)]));
  check("C18 the public report NEVER carries the admin-only detail (host names etc.)", !/neon\.tech|ep-steep|lastErrorDetail/.test(json), json.slice(0, 200));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
