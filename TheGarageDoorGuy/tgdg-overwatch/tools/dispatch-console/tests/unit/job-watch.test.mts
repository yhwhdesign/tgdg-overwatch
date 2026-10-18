// @ts-nocheck
import { evaluateJobs, checkJobs, getJobWatch, resetJobWatchCache, readWatchRules, jobUrl, validJobUrlTemplate, DEFAULT_JOB_URL_TEMPLATE, classifyJob, jobLabel, jobTexts, noteTexts, DEFAULT_RULES, type WatchHelpers } from "../../src/lib/job-watch.ts";
import { calendarDayBounds, businessTimeZone } from "../../src/lib/availability.ts";
import { describeSyncError } from "../../src/lib/sync-status.ts";
import { employeeToTechnician, isCanceled, type HcpApi, type HcpJob, type HcpEmployee, type JobsPage } from "../../src/lib/hcp-sync.ts";

process.env.BUSINESS_TIMEZONE = "America/Chicago";
let passes = 0, failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${name}${detail ? "  <- " + detail : ""}`); } };
const eq = (name: string, a: unknown, b: unknown) => check(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);

const helpers: WatchHelpers = { timeZone: businessTimeZone, dayBounds: calendarDayBounds, isCanceled, employeeName: (e) => employeeToTechnician(e).name, describeError: describeSyncError };
const NOW = new Date("2026-10-12T19:00:00Z");           // 2:00 PM in Chicago (CDT), Monday 12 October
const ago = (minutes: number, from = NOW) => new Date(from.getTime() - minutes * 60_000).toISOString();
const names = new Map([["pro_a", "Alex Tech"], ["pro_b", "Blake Tech"], ["pro_c", "Casey Tech"]]);
let counter = 0;
const job = (o: Partial<HcpJob> & { startedAgo?: number | null; completedAgo?: number | null } = {}): HcpJob => {
  const { startedAgo, completedAgo, ...rest } = o;
  return { id: `job_${String(++counter).padStart(32, "0")}`, work_status: "in progress", assigned_employees: [{ id: "pro_a" }], job_fields: { job_type: { name: "Service call" } },
    work_timestamps: { started_at: startedAgo == null ? null : ago(startedAgo), completed_at: completedAgo == null ? null : ago(completedAgo) }, ...rest };
};
const run = (jobs: HcpJob[], now = NOW, rules = DEFAULT_RULES) => evaluateJobs(jobs, names, now, rules, helpers);

// ================= A. the settings =================
eq("A1 defaults: install 90, service 60, the word 'install', finished jobs announced for 3 hours, notes on", readWatchRules({}), { installMinutes: 90, serviceMinutes: 60, installWords: ["install"], completedHours: 3, showNotes: true, jobUrlTemplate: "https://pro.housecallpro.com/app/jobs/{id}" });
eq("A2 custom values are used", readWatchRules({ JOB_WATCH_INSTALL_MINUTES: "120", JOB_WATCH_SERVICE_MINUTES: "45", JOB_WATCH_INSTALL_WORDS: " Install , NEW DOOR ,, replacement " }), { installMinutes: 120, serviceMinutes: 45, installWords: ["install", "new door", "replacement"], completedHours: 3, showNotes: true, jobUrlTemplate: "https://pro.housecallpro.com/app/jobs/{id}" });
for (const bad of ["", "abc", "0", "-5", "4", "1.5", "99999", "NaN", " "]) eq(`A3 an unusable minutes setting "${bad}" falls back to the default`, [readWatchRules({ JOB_WATCH_INSTALL_MINUTES: bad }).installMinutes, readWatchRules({ JOB_WATCH_SERVICE_MINUTES: bad }).serviceMinutes], [90, 60]);
eq("A4 only commas for the words falls back to 'install'", readWatchRules({ JOB_WATCH_INSTALL_WORDS: " , ,, " }).installWords, ["install"]);
eq("A5 the smallest (5) and largest (1440) allowed minutes are accepted", [readWatchRules({ JOB_WATCH_SERVICE_MINUTES: "5" }).serviceMinutes, readWatchRules({ JOB_WATCH_INSTALL_MINUTES: "1440" }).installMinutes], [5, 1440]);

// ================= B. install or service? =================
const kind = (j: Partial<HcpJob>, words = ["install"]) => classifyJob({ id: "x", ...j }, words);
eq("B1 job type as plain text 'Garage Door Install'", kind({ job_fields: { job_type: "Garage Door Install" } }), "install");
eq("B2 job type as an object with a name", kind({ job_fields: { job_type: { id: "jbt_1", name: "Install" } } }), "install");
eq("B3 an object with only an id (no readable name) is service", kind({ job_fields: { job_type: { id: "jbt_1" } } }), "service");
eq("B4 matching ignores upper and lower case", [kind({ job_fields: { job_type: "INSTALLATION" } }), kind({ job_fields: { job_type: "iNsTaLl" } })], ["install", "install"]);
eq("B5 a tag says install (list of strings)", kind({ tags: ["Residential", "Install"] }), "install");
eq("B6 a tag says install (list of objects)", kind({ tags: [{ name: "Spring Repair" }, { name: "Install crew" }] }), "install");
eq("B7 the description says install", kind({ description: "Customer wants a NEW opener installed" }), "install");
eq("B8 the business unit says install", kind({ job_fields: { business_unit: "Residential Installation" } }), "install");
eq("B9 a line item says install", kind({ line_items: [{ name: "Install 16x7 door" }] }), "install");
eq("B10 nothing about install anywhere: service", kind({ job_fields: { job_type: { name: "Repair" } }, description: "Broken spring", tags: ["Urgent"] }), "service");
eq("B11 no fields at all: service", kind({}), "service");
eq("B12 your own words work: 'replacement' and 'new door'", [kind({ description: "Door replacement" }, ["replacement"]), kind({ name: "New Door" }, ["new door"]), kind({ name: "Door replacement" }, ["install"])], ["install", "install", "service"]);
for (const weird of [5, true, null, undefined, [[[[["install"]]]]], { a: { b: "install" } }, () => 1, Symbol.iterator as unknown]) {
  let result = "ok"; try { kind({ job_fields: { job_type: weird }, tags: weird, description: weird, line_items: weird }); } catch (e) { result = "THREW " + (e as Error).message; }
  check(`B13 a strange value (${typeof weird}) never crashes the classifier`, result === "ok", result);
}
check("B14 a very long list of tags is capped and still answers", (() => { const tags = Array.from({ length: 500 }, (_, i) => `tag${i}`); return kind({ tags }) === "service" && jobTexts({ id: "x", tags }).length <= 40; })());
eq("B15 'reinstall' counts as install (the word is matched inside text)", kind({ description: "reinstall track" }), "install");

// ================= C. the label =================
eq("C1 type and number", jobLabel({ id: "x", job_fields: { job_type: { name: "Garage Door Install" } }, invoice_number: 4521 }, "install"), "Garage Door Install #4521");
eq("C2 no type: 'Install' or 'Service'", [jobLabel({ id: "x" }, "install"), jobLabel({ id: "x" }, "service")], ["Install", "Service"]);
eq("C3 a tag is used when there is no job type", jobLabel({ id: "x", tags: ["Spring Repair"] }, "service"), "Spring Repair");
eq("C4 a long type name is cut to 32 characters", jobLabel({ id: "x", job_fields: { job_type: "A".repeat(80) } }, "service").length, 32);
eq("C5 a blank or missing job number adds nothing", [jobLabel({ id: "x", invoice_number: "  " }, "service"), jobLabel({ id: "x", invoice_number: null }, "service"), jobLabel({ id: "x", invoice_number: 0 }, "service")], ["Service", "Service", "Service #0"]);
eq("C6 a string job number is trimmed and cut to 12", jobLabel({ id: "x", invoice_number: " INV-123456789012345 " }, "service"), "Service #INV-12345678");

// ================= D. when it alerts (the user's rules: install 90, service 60) =================
const alertsFor = (type: string, minutes: number) => run([job({ startedAgo: minutes, job_fields: { job_type: { name: type } } })]).alerts.length;
eq("D1 an install at 89 minutes: no alert", alertsFor("Install", 89), 0);
eq("D2 an install at exactly 90 minutes: ALERT", alertsFor("Install", 90), 1);
eq("D3 an install at 91 minutes: alert", alertsFor("Install", 91), 1);
eq("D4 service work at 59 minutes: no alert", alertsFor("Service call", 59), 0);
eq("D5 service work at exactly 60 minutes: ALERT", alertsFor("Service call", 60), 1);
eq("D6 service work at 61 minutes: alert", alertsFor("Repair", 61), 1);
eq("D7 an install at 60 minutes does NOT alert (it has the longer limit)", alertsFor("Install", 60), 0);
let r = run([job({ startedAgo: 0 })]);
eq("D8 a job started just now is watched but quiet", [r.watching, r.alerts.length], [1, 0]);
r = run([job({ startedAgo: 105, job_fields: { job_type: { name: "Install" } }, invoice_number: 77, assigned_employees: [{ id: "pro_a" }] })]);
const a = r.alerts[0];
eq("D9 the alert says who, what, how long, since when and the limit", [a.techs, a.label, a.kind, a.minutesOnJob, a.limitMinutes, a.startedLabel], [["Alex Tech"], "Install #77", "install", 105, 90, "12:15 PM"]);
check("D10 its id is the job and the limit, so a dismissal sticks", a.id.endsWith("@90") && a.id.startsWith(a.jobId), a.id);
check("D11 the start time is also given exactly", a.startedAt === ago(105), a.startedAt);
r = run([job({ startedAgo: 61 }), job({ startedAgo: 200 }), job({ startedAgo: 75 })]);
eq("D12 several alerts come longest first", r.alerts.map((x) => x.minutesOnJob), [200, 75, 61]);
r = run([job({ startedAgo: 60.9 as unknown as number })]);
eq("D13 a part-minute rounds down (60.9 min is 60: alert, shows 60)", [r.alerts.length, r.alerts[0]?.minutesOnJob], [1, 60]);
const custom = { ...DEFAULT_RULES, installMinutes: 120, serviceMinutes: 30, installWords: ["replacement"] };
r = run([job({ startedAgo: 35, description: "service" }), job({ startedAgo: 100, description: "Door replacement" })], NOW, custom);
eq("D14 custom rules apply (service 30, 'replacement' is an install with a 120 limit)", [r.alerts.length, r.alerts[0]?.limitMinutes, r.watching], [1, 30, 2]);

// ================= E. who is named =================
r = run([job({ startedAgo: 70, assigned_employees: [{ id: "pro_a" }, { id: "pro_b" }] })]);
eq("E1 two techs on one job are named together", r.alerts[0].techs, ["Alex Tech", "Blake Tech"]);
r = run([job({ startedAgo: 70, assigned_employees: [{ id: "pro_a" }, { id: "pro_a" }] })]);
eq("E2 a tech listed twice is named once", r.alerts[0].techs, ["Alex Tech"]);
r = run([job({ startedAgo: 70, assigned_employees: [{ id: "pro_zzzz1234" }] })]);
eq("E3 an unknown employee still gets a readable name", r.alerts[0].techs, ["Technician …1234"]);
r = run([job({ startedAgo: 70, assigned_employees: [] }), job({ startedAgo: 70, assigned_employees: null })]);
eq("E4 nobody assigned: 'A technician' (still alerts: someone is on the job)", r.alerts.map((x) => x.techs), [["A technician"], ["A technician"]]);

// ================= F. which jobs count as 'on a job' =================
eq("F1 a canceled job is ignored entirely", run([job({ startedAgo: 200, work_status: "user canceled" })]), { watching: 0, alerts: [], cantTell: 0, ignoredOlder: 0, completed: [] });
eq("F2 so is one with canceled_at or deleted_at", run([job({ startedAgo: 200, canceled_at: ago(10) }), job({ startedAgo: 200, deleted_at: ago(10) })]), { watching: 0, alerts: [], cantTell: 0, ignoredOlder: 0, completed: [] });
eq("F3 a finished job (completed_at) is not 'on a job'", run([job({ startedAgo: 200, completedAgo: 20 })]).watching, 0);
eq("F4 neither is 'complete rated' / 'complete unrated' status, even with no completed_at", run([job({ startedAgo: 200, work_status: "complete rated" }), job({ startedAgo: 200, work_status: "complete unrated" })]).watching, 0);
eq("F5 'in progress' but nobody tapped Start: cannot tell (counted, no alert)", run([job({ startedAgo: null })]), { watching: 0, alerts: [], cantTell: 1, ignoredOlder: 0, completed: [] });
eq("F6 a scheduled job nobody has started is simply not on a job (not counted as 'cannot tell')", run([job({ startedAgo: null, work_status: "scheduled" })]), { watching: 0, alerts: [], cantTell: 0, ignoredOlder: 0, completed: [] });
eq("F7 an unreadable start time counts as no start time", run([job({ work_timestamps: { started_at: "yesterday-ish" } })]).cantTell, 1);
eq("F8 a start time more than 5 minutes in the future is a clock problem: cannot tell", run([job({ startedAgo: -30 })]), { watching: 0, alerts: [], cantTell: 1, ignoredOlder: 0, completed: [] });
r = run([job({ startedAgo: -3 })]);
eq("F9 up to 5 minutes in the future is tolerated (clock drift), counted as 0 minutes", [r.watching, r.alerts.length, r.cantTell], [1, 0, 0]);
eq("F10 started with an odd status ('scheduled') but a start tap exists: it is on a job", run([job({ startedAgo: 70, work_status: "scheduled" })]).alerts.length, 1);
eq("F11 jobs without a work_timestamps field at all are fine", run([{ id: "j", work_status: "scheduled" }, { id: "k", work_status: "in progress" }]), { watching: 0, alerts: [], cantTell: 1, ignoredOlder: 0, completed: [] });
eq("F12 an empty list is an empty answer", run([]), { watching: 0, alerts: [], cantTell: 0, ignoredOlder: 0, completed: [] });

// ================= G. 'today' is the BUSINESS day, wherever the server runs =================
const midnightish = new Date("2026-10-13T04:30:00Z");   // 11:30 PM Monday in Chicago
r = evaluateJobs([job({ startedAgo: 90, work_timestamps: { started_at: new Date("2026-10-13T03:00:00Z").toISOString() } })], names, midnightish, DEFAULT_RULES, helpers);
eq("G1 started 10 PM Monday, it is 11:30 PM Monday: same business day, 90 minutes: alert", [r.watching, r.alerts.length, r.alerts[0]?.minutesOnJob], [1, 1, 90]);
const afterMidnight = new Date("2026-10-13T06:30:00Z"); // 1:30 AM Tuesday in Chicago
r = evaluateJobs([job({ work_timestamps: { started_at: new Date("2026-10-13T04:30:00Z").toISOString() } })], names, afterMidnight, DEFAULT_RULES, helpers);
eq("G2 started 11:30 PM Monday, now 1:30 AM Tuesday: a different business day, so it is not judged", [r.watching, r.ignoredOlder, r.alerts.length], [0, 1, 0]);
r = run([job({ startedAgo: 60 * 24 + 5 }), job({ startedAgo: 60 * 30 })]);
eq("G3 a multi-day install that started on an earlier day is not 'on a job' (no '26 hours' alert)", [r.watching, r.ignoredOlder, r.alerts.length], [0, 2, 0]);
const nov1 = new Date("2026-11-01T18:00:00Z");           // the day clocks go back (25-hour day): noon CST
r = evaluateJobs([job({ work_timestamps: { started_at: new Date("2026-11-01T14:00:00Z").toISOString() } })], names, nov1, DEFAULT_RULES, helpers);
eq("G4 on the 25-hour day clocks go back, a job started 4 hours ago (real time) is judged correctly", [r.watching, r.alerts[0]?.minutesOnJob], [1, 240]);
r = run([job({ startedAgo: 120, work_timestamps: { started_at: "2026-10-12T14:12:00Z" } })]);
check("G5 the shown start time reads like '9:12 AM' with an ordinary space", r.alerts[0].startedLabel === "9:12 AM", JSON.stringify(r.alerts[0].startedLabel));

// ================= H. asking Housecall Pro =================
type Call = { method: string; args?: unknown };
function fakeApi(opts: { pages?: JobsPage[]; employees?: HcpEmployee[]; failWith?: Error; infinite?: boolean; details?: Record<string, HcpJob | null | Error> } = {}) {
  const calls: Call[] = [];
  const target: Partial<HcpApi> = {
    async getJob(id: string) { calls.push({ method: "getJob", args: id }); const d = opts.details?.[id]; if (d instanceof Error) throw d; return d ?? null; },
    async listEmployees() { calls.push({ method: "listEmployees" }); if (opts.failWith) throw opts.failWith; return opts.employees ?? [{ id: "pro_a", first_name: "Alex", last_name: "Tech", role: "field tech" }]; },
    async *listJobsInWindow(from: Date, to: Date, o: { pageSize: number }) {
      calls.push({ method: "listJobsInWindow", args: { from: from.toISOString(), to: to.toISOString(), pageSize: o.pageSize } });
      if (opts.failWith) throw opts.failWith;
      if (opts.infinite) { for (let p = 1; ; p++) yield { jobs: [], page: p, totalPages: 9999, totalItems: 0 }; }
      for (const page of opts.pages ?? [{ jobs: [], page: 1, totalPages: 1, totalItems: 0 }]) yield page;
    },
  };
  // anything other than the two read calls Job Watch needs would be a bug: make it loud
  const api = new Proxy(target, { get(t, prop) { if (prop in t) return (t as Record<string | symbol, unknown>)[prop]; if (typeof prop === "symbol" || prop === "then") return undefined; return () => { throw new Error(`Job Watch must not call ${String(prop)}`); }; } }) as HcpApi;
  return { api, calls };
}
resetJobWatchCache();
let f = fakeApi({ pages: [{ jobs: [job({ startedAgo: 75, assigned_employees: [{ id: "pro_a" }] })], page: 1, totalPages: 1, totalItems: 1 }] });
let res = await checkJobs(f.api, NOW, DEFAULT_RULES, helpers);
check("H1 a normal check succeeds and names the tech from Housecall Pro's employee list", res.ok && res.alerts.length === 1 && res.alerts[0].techs[0] === "Alex Tech", JSON.stringify(res));
const win = (f.calls.find((c) => c.method === "listJobsInWindow")!.args) as { from: string; to: string; pageSize: number };
eq("H2 it asks for YESTERDAY and TODAY in business time (midnight Oct 11 to midnight Oct 13, Chicago), 100 per page", win, { from: "2026-10-11T05:00:00.000Z", to: "2026-10-13T05:00:00.000Z", pageSize: 100 });
eq("H3 with nothing finished it only ever uses the two read calls (listJobsInWindow, listEmployees)", [...new Set(f.calls.map((c) => c.method))].sort(), ["listEmployees", "listJobsInWindow"]);
resetJobWatchCache();
f = fakeApi({ pages: [{ jobs: [job({ startedAgo: 75 })], page: 1, totalPages: 2, totalItems: 2 }, { jobs: [job({ startedAgo: 80 })], page: 2, totalPages: 2, totalItems: 2 }] });
res = await checkJobs(f.api, NOW, DEFAULT_RULES, helpers);
check("H4 jobs on several pages are all read", res.ok && res.alerts.length === 2, JSON.stringify(res));
resetJobWatchCache();
f = fakeApi({ infinite: true });
res = await checkJobs(f.api, NOW, DEFAULT_RULES, helpers);
check("H5 a runaway list stops after 10 pages instead of looping", res.ok && res.watching === 0, JSON.stringify(res));
resetJobWatchCache();
f = fakeApi({ pages: [{ jobs: [job({ startedAgo: 75 })], page: 1, totalPages: 1, totalItems: 1 }] });
res = await checkJobs(f.api, NOW, DEFAULT_RULES, helpers);
check("H6 the answer carries the time it was checked, the counts, and the rules in force", res.ok && res.checkedAt === NOW.toISOString() && res.rules.installMinutes === 90 && res.rules.serviceMinutes === 60 && res.watching === 1 && res.cantTell === 0 && res.ignoredOlder === 0);
const errors: string[] = []; const origError = console.error; console.error = (...x: unknown[]) => { errors.push(x.join(" ")); };
for (const [label, err, expected] of [
  ["no key", new Error("HCP_API_KEY is not set"), /not connected yet/],
  ["rejected key", new Error("HCP rejected the API key (HTTP 401). Check HCP_API_KEY"), /rejected the key/],
  ["rate limit", new Error("HCP API error 429 on /jobs"), /limiting how often/],
  ["offline", new TypeError("fetch failed"), /could not be reached/],
  ["server trouble", new Error("HCP API error 503 on /jobs: <html>secret-body-text</html>"), /problem on its side/],
  ["something odd", new Error("kaboom with token sk_live_abcdef0123456789 in it"), /unexpected error/],
] as Array<[string, Error, RegExp]>) {
  resetJobWatchCache();
  const bad = await checkJobs(fakeApi({ failWith: err }).api, NOW, DEFAULT_RULES, helpers);
  check(`H7 failure (${label}): a plain message, ok:false`, !bad.ok && expected.test((bad as { error: string }).error), JSON.stringify(bad));
  check(`H8 failure (${label}): the public message never contains the raw detail`, !bad.ok && !/secret-body|sk_live|abcdef0123/.test((bad as { error: string }).error), JSON.stringify(bad));
}
check("H9 the detail went to the server log instead", errors.some((e) => /\[job-watch\] check failed/.test(e)) && errors.some((e) => /kaboom/.test(e)));
console.error = origError;

// ================= I. nothing about customers ever leaves =================
resetJobWatchCache();
const withCustomer = job({ startedAgo: 120, description: "Install for Jane Customer at 12 Secret Ln, gate code 1234", job_fields: { job_type: { name: "Install" } } }) as HcpJob & Record<string, unknown>;
withCustomer.customer = { first_name: "Jane", last_name: "Customer", mobile_number: "501-555-0101", email: "jane@example.com" };
withCustomer.address = { street: "12 Secret Ln", city: "Little Rock", zip: "72201" };
withCustomer.notes = [{ content: "gate code 1234" }];
withCustomer.invoice_number = 9001;
res = await checkJobs(fakeApi({ pages: [{ jobs: [withCustomer], page: 1, totalPages: 1, totalItems: 1 }] }).api, NOW, DEFAULT_RULES, helpers);
const out = JSON.stringify(res);
check("I1 the job was found and classified as an install (from its description)", res.ok && res.alerts.length === 1 && res.alerts[0].kind === "install", out);
check("I2 NO customer detail appears anywhere in the answer (name, phone, email, street, gate code, description)", !/Jane|Customer|501-555|jane@|Secret|Little Rock|72201|gate code|1234/.test(out), out);
eq("I3 the answer's job fields are exactly the safe ones", Object.keys((res as { alerts: object[] }).alerts[0]).sort(), ["id", "jobId", "kind", "label", "limitMinutes", "minutesOnJob", "startedAt", "startedLabel", "techs", "url"]);

// ================= J. the cache =================
resetJobWatchCache();
f = fakeApi({ pages: [{ jobs: [job({ startedAgo: 75 })], page: 1, totalPages: 1, totalItems: 1 }] });
let clock = NOW.getTime(); const now = () => new Date(clock);
const asked = () => f.calls.filter((c) => c.method === "listJobsInWindow").length;
await getJobWatch({ api: f.api, helpers, now }); await getJobWatch({ api: f.api, helpers, now });
eq("J1 two requests inside a minute cost ONE request to Housecall Pro", asked(), 1);
clock += 59_000; await getJobWatch({ api: f.api, helpers, now });
eq("J2 still cached at 59 seconds", asked(), 1);
clock += 2_000; await getJobWatch({ api: f.api, helpers, now });
eq("J3 refreshed after a minute", asked(), 2);
resetJobWatchCache(); f = fakeApi({ pages: [{ jobs: [], page: 1, totalPages: 1, totalItems: 0 }] }); clock = NOW.getTime();
await Promise.all(Array.from({ length: 8 }, () => getJobWatch({ api: f.api, helpers, now })));
eq("J4 eight panels asking at the same instant share ONE request", asked(), 1);
eq("J5 and the employee list was fetched once", f.calls.filter((c) => c.method === "listEmployees").length, 1);
clock += 61_000; await getJobWatch({ api: f.api, helpers, now });
eq("J6 an hour later the names are re-read; before that they are kept (employees fetched: still 1 after 61 s)", f.calls.filter((c) => c.method === "listEmployees").length, 1);
clock += 61 * 60_000; await getJobWatch({ api: f.api, helpers, now });
eq("J7 ...after 61 minutes they are fetched again", f.calls.filter((c) => c.method === "listEmployees").length, 2);
resetJobWatchCache(); clock = NOW.getTime(); const quiet = console.error; console.error = () => {};
f = fakeApi({ failWith: new Error("fetch failed") });
await getJobWatch({ api: f.api, helpers, now }); clock += 10_000; await getJobWatch({ api: f.api, helpers, now });
eq("J8 a failure is remembered for a short while (no hammering a struggling service)", asked(), 1);
clock += 6_000; await getJobWatch({ api: f.api, helpers, now });
eq("J9 ...but retried after 15 seconds", asked(), 2);
console.error = quiet;
resetJobWatchCache(); clock = NOW.getTime(); f = fakeApi();
await getJobWatch({ api: f.api, helpers, now }); clock -= 10 * 60_000; await getJobWatch({ api: f.api, helpers, now });
eq("J10 a clock that jumps BACKWARDS never serves a stale answer", asked(), 2);
resetJobWatchCache(); f = fakeApi(); clock = NOW.getTime();
await getJobWatch({ api: f.api, helpers, now }); resetJobWatchCache(); await getJobWatch({ api: f.api, helpers, now });
eq("J11 resetting the cache forces a fresh read", asked(), 2);

// ================= L. jobs a tech has just FINISHED (with the job's notes) =================
const fin = (finishedAgo: number, o: Partial<HcpJob> = {}) => job({ work_status: "complete rated", startedAgo: finishedAgo + 65, completedAgo: finishedAgo, ...o });
let L = run([fin(20, { invoice_number: 4521, job_fields: { job_type: { name: "Garage Door Install" } }, assigned_employees: [{ id: "pro_a" }, { id: "pro_b" }], notes: [{ id: "n1", content: "Replaced both springs.   Customer wants a\nquote for a new opener." }] })]);
let c = L.completed[0];
eq("L1 a finished job is reported: who, what, when, how long it took, and the notes (whitespace tidied)", [c.techs, c.label, c.kind, c.completedLabel, c.minutesOnJob, c.notes, c.notesPending, c.notesHidden], [["Alex Tech", "Blake Tech"], "Garage Door Install #4521", "install", "1:40 PM", 65, ["Replaced both springs. Customer wants a quote for a new opener."], false, false]);
check("L2 its id is the job plus the moment of finishing", c.id === `${c.jobId}#${Date.parse(c.completedAt)}` && c.completedAt === ago(20), c.id);
eq("L3 finishing a job is not 'on a job': nothing is being watched and no overtime alert", [L.watching, L.alerts.length], [0, 0]);
L = run([fin(50), fin(10), fin(30)]);
eq("L4 several finished jobs come newest first", L.completed.map((x) => Math.round((NOW.getTime() - Date.parse(x.completedAt)) / 60000)), [10, 30, 50]);
eq("L5 announced for 3 hours (180 minutes is in, 181 is out)", [run([fin(179)]).completed.length, run([fin(180)]).completed.length, run([fin(181)]).completed.length], [1, 1, 0]);
const oneHour = { ...DEFAULT_RULES, completedHours: 1 };
eq("L6 the window can be changed (1 hour: 60 minutes is in, 61 is out)", [run([fin(60)], NOW, oneHour).completed.length, run([fin(61)], NOW, oneHour).completed.length], [1, 0]);
eq("L7 a finish time a few minutes in the future (clock drift) is tolerated; far in the future is ignored", [run([fin(-3)]).completed.length, run([fin(-3)]).completed[0]?.minutesOnJob, run([fin(-6)]).completed.length], [1, 65, 0]);   // started 62 min ago, 'finishes' in 3: 65 minutes
eq("L8 canceled, still-in-progress, and 'complete' with no finish tap are never reported", [run([fin(20, { work_status: "user canceled" })]).completed.length, run([fin(20, { canceled_at: ago(5) })]).completed.length, run([job({ startedAgo: 30 })]).completed.length, run([job({ work_status: "complete rated", startedAgo: 80 })]).completed.length], [0, 0, 0, 0]);
eq("L9 no Start tap: the time taken is unknown, not wrong", run([fin(20, { work_timestamps: { completed_at: ago(20) } })]).completed[0].minutesOnJob, null);
eq("L10 a Start tap AFTER the Finish tap (a clock problem) also gives 'unknown'", run([fin(20, { work_timestamps: { started_at: ago(5), completed_at: ago(20) } })]).completed[0].minutesOnJob, null);
eq("L11 nobody assigned or an unknown employee still reads sensibly", [run([fin(20, { assigned_employees: [] })]).completed[0].techs, run([fin(20, { assigned_employees: [{ id: "pro_zzzz9876" }] })]).completed[0].techs], [["A technician"], ["Technician …9876"]]);
eq("L12 at most 20 are reported", run(Array.from({ length: 35 }, (_, i) => fin(5 + i))).completed.length, 20);
// the notes
eq("L13 notes in several shapes: content/text/note/body/message/description, and the last three kept", noteTexts([{ content: "a" }, { text: "b" }, { note: "c" }, { body: "d" }, { message: "e" }, { description: "f" }]), ["d", "e", "f"]);
eq("L14 notes as plain text, as one string, and mixed with junk", [noteTexts(["x", "y"]), noteTexts("solo"), noteTexts([null, 5, {}, { content: "  " }, { content: "ok" }, [["deep"]], true])], [["x", "y"], ["solo"], ["ok"]]);
eq("L15 an object with several text fields uses the first sensible one only", noteTexts([{ text: "second", content: "first" }]), ["first"]);
eq("L16 nothing usable gives no notes (never a crash)", [undefined, null, 5, true, {}, [], "   ", () => 1].map((v) => noteTexts(v)), [[], [], [], [], [], [], [], []]);
eq("L17 a long note is cut to 300 characters followed by three dots", [noteTexts(["z".repeat(500)])[0].length, noteTexts(["z".repeat(500)])[0].endsWith("zzz..."), noteTexts(["z".repeat(300)])[0].length], [303, true, 300]);
eq("L18 the total stays under about 700 characters (the oldest of three long notes is dropped)", noteTexts(["a".repeat(300), "b".repeat(300), "c".repeat(300)]).map((t) => t[0]), ["b", "c"]);
eq("L19 a hundred notes: only the last three", noteTexts(Array.from({ length: 100 }, (_, i) => `note ${i}`)), ["note 97", "note 98", "note 99"]);
eq("L20 HTML in a note stays plain text (it is only ever displayed as text)", noteTexts(["<img src=x onerror=alert(1)>"]), ["<img src=x onerror=alert(1)>"]);
// notes that have not arrived yet
eq("L21 finished 5 minutes ago with no notes: 'pending' (a tech may still be typing)", [run([fin(5, { notes: [] })]).completed[0].notesPending, run([fin(9, { notes: [] })]).completed[0].notesPending, run([fin(10, { notes: [] })]).completed[0].notesPending, run([fin(40, { notes: [] })]).completed[0].notesPending], [true, true, false, false]);
eq("L22 notes present means never pending, however fresh", run([fin(2, { notes: ["Done"] })]).completed[0].notesPending, false);
eq("L23 a missing notes field in the list is treated as no notes (the detail read fills it in when it can)", run([fin(30)]).completed[0].notes, []);
// switch notes off
const noNotes = { ...DEFAULT_RULES, showNotes: false };
c = run([fin(5, { notes: ["Secret gate code 4471"] })], NOW, noNotes).completed[0];
eq("L24 notes switched off: none returned, flagged as hidden, and never 'pending'", [c.notes, c.notesHidden, c.notesPending], [[], true, false]);
eq("L25 the setting: off/false/no/0 turn notes off; on, yes, 1, empty and unset leave them on", ["off", "OFF", "false", "no", "0", " Off "].map((v) => readWatchRules({ JOB_WATCH_SHOW_NOTES: v }).showNotes).concat(["on", "yes", "1", "", undefined as unknown as string, "anything"].map((v) => readWatchRules({ JOB_WATCH_SHOW_NOTES: v }).showNotes)), [false, false, false, false, false, false, true, true, true, true, true, true]);
eq("L26 the announcing window setting: 1-12 hours; anything else is 3", ["6", "1", "12", "0", "13", "abc", "1.5", "", "-2"].map((v) => readWatchRules({ JOB_WATCH_COMPLETED_HOURS: v }).completedHours), [6, 1, 12, 3, 3, 3, 3, 3, 3]);
// privacy
const done = fin(15, { notes: [{ content: "Gate code 4471. Customer wants a quote." }], description: "Install for Jane Customer at 12 Secret Ln" }) as HcpJob & Record<string, unknown>;
done.customer = { first_name: "Jane", last_name: "Customer", mobile_number: "501-555-0101", email: "jane@example.com" };
done.address = { street: "12 Secret Ln", city: "Little Rock", zip: "72201" };
const pj = run([done]); const pjText = JSON.stringify(pj);
eq("L27 a finished job returns exactly the intended fields and no others", Object.keys(pj.completed[0]).sort(), ["completedAt", "completedLabel", "id", "jobId", "kind", "label", "minutesOnJob", "notes", "notesHidden", "notesPending", "techs", "url"]);
check("L28 the notes ARE returned (that is the point of the notification)...", pjText.includes("Gate code 4471. Customer wants a quote."), pjText);
check("L29 ...but nothing else about the customer is: no name, phone, email, address, or the description text", !/Jane|Customer"|501-555|jane@|Secret|Little Rock|72201|Install for/.test(pjText.replace("Customer wants a quote", "")), pjText);
const inProgress = job({ startedAgo: 120, notes: [{ content: "Gate code 4471 while still working" }] });
check("L30 the notes of a job STILL IN PROGRESS are never returned (not in alerts, not anywhere)", !JSON.stringify(run([inProgress])).includes("4471"), JSON.stringify(run([inProgress])));

// reading a finished job's notes when the list does not carry them
resetJobWatchCache();
const noteless = (id: string, finishedAgo: number, o: Partial<HcpJob> = {}) => ({ ...fin(finishedAgo, o), id });
let jobA = noteless("job_aaaa", 30);
let fd = fakeApi({ pages: [{ jobs: [jobA], page: 1, totalPages: 1, totalItems: 1 }], details: { job_aaaa: { id: "job_aaaa", notes: [{ content: "Sprung cable replaced; needs new opener quote" }] } } });
let out2 = await checkJobs(fd.api, NOW, DEFAULT_RULES, helpers);
check("L31 a finished job whose list entry has NO notes field: its full record is read once and the notes are used", out2.ok && out2.completed[0].notes[0] === "Sprung cable replaced; needs new opener quote" && fd.calls.filter((x) => x.method === "getJob").length === 1, JSON.stringify(out2));
await checkJobs(fd.api, NOW, DEFAULT_RULES, helpers);
check("L32 ...and not read again on the next check (it is old enough to be final)", fd.calls.filter((x) => x.method === "getJob").length === 1);
fd = fakeApi({ pages: [{ jobs: [noteless("job_b1", 30, { notes: [] }), noteless("job_b2", 30, { notes: ["x"] }), job({ startedAgo: 40 }), noteless("job_b3", 30, { work_status: "user canceled" }), noteless("job_b4", 400)], page: 1, totalPages: 1, totalItems: 5 }] });
await checkJobs(fd.api, NOW, DEFAULT_RULES, helpers);
check("L33 no read is made when notes are present (even empty), for jobs in progress, canceled, or finished long ago", fd.calls.filter((x) => x.method === "getJob").length === 0, JSON.stringify(fd.calls.filter((x) => x.method === "getJob")));
resetJobWatchCache();
fd = fakeApi({ pages: [{ jobs: [noteless("job_fresh", 3)], page: 1, totalPages: 1, totalItems: 1 }], details: { job_fresh: { id: "job_fresh", notes: [] } } });
out2 = await checkJobs(fd.api, NOW, DEFAULT_RULES, helpers);
const pending1 = out2.ok && out2.completed[0].notesPending;
fd.api = fd.api; (fd as { calls: unknown[] }).calls.length = 0;
const fd2 = fakeApi({ pages: [{ jobs: [noteless("job_fresh", 4)], page: 1, totalPages: 1, totalItems: 1 }], details: { job_fresh: { id: "job_fresh", notes: [{ content: "Done. Needs estimate for gate opener." }] } } });
const out3 = await checkJobs(fd2.api, new Date(NOW.getTime() + 60_000), DEFAULT_RULES, helpers);
check("L34 a FRESH finish is shown as 'notes pending', and when the tech types notes a minute later the next check picks them up (a fresh job is not cached)", pending1 === true && out3.ok && out3.completed[0].notes[0] === "Done. Needs estimate for gate opener." && out3.completed[0].notesPending === false && fd2.calls.filter((x) => x.method === "getJob").length === 1);
resetJobWatchCache();
fd = fakeApi({ pages: [{ jobs: [noteless("job_n", 30)], page: 1, totalPages: 1, totalItems: 1 }] });
out2 = await checkJobs(fd.api, NOW, DEFAULT_RULES, helpers); await checkJobs(fd.api, NOW, DEFAULT_RULES, helpers);
check("L35 if Housecall Pro has no such record (null) the job is still announced, with no notes, and the answer is remembered", out2.ok && out2.completed.length === 1 && out2.completed[0].notes.length === 0 && fd.calls.filter((x) => x.method === "getJob").length === 1);
resetJobWatchCache();
const errLog = console.error; console.error = () => {};
fd = fakeApi({ pages: [{ jobs: [noteless("job_e", 30)], page: 1, totalPages: 1, totalItems: 1 }], details: { job_e: new Error("HCP API error 500") } });
out2 = await checkJobs(fd.api, NOW, DEFAULT_RULES, helpers); await checkJobs(fd.api, NOW, DEFAULT_RULES, helpers);
console.error = errLog;
check("L36 if reading the notes FAILS the finish is still announced (the notes are a bonus), and it is tried again next time", out2.ok && out2.completed.length === 1 && out2.completed[0].notes.length === 0 && fd.calls.filter((x) => x.method === "getJob").length === 2);
resetJobWatchCache();
fd = fakeApi({ pages: [{ jobs: Array.from({ length: 15 }, (_, i) => noteless(`job_m${i}`, 30)), page: 1, totalPages: 1, totalItems: 15 }] });
await checkJobs(fd.api, NOW, DEFAULT_RULES, helpers);
const firstRound = fd.calls.filter((x) => x.method === "getJob").length;
await checkJobs(fd.api, NOW, DEFAULT_RULES, helpers);
eq("L37 at most 10 full records are read per check (15 finished jobs: 10, then the other 5)", [firstRound, fd.calls.filter((x) => x.method === "getJob").length], [10, 15]);
resetJobWatchCache();
fd = fakeApi({ pages: [{ jobs: [noteless("job_off", 30)], page: 1, totalPages: 1, totalItems: 1 }] });
await checkJobs(fd.api, NOW, noNotes, helpers);
eq("L38 with notes switched off nothing extra is read from Housecall Pro", fd.calls.filter((x) => x.method === "getJob").length, 0);
resetJobWatchCache();
fd = fakeApi({ pages: [{ jobs: [noteless("job_r", 30), job({ startedAgo: 75 })], page: 1, totalPages: 1, totalItems: 2 }] });
await checkJobs(fd.api, NOW, DEFAULT_RULES, helpers);
eq("L39 everything asked of Housecall Pro is a read: the job list, the employees, and a single job's record", [...new Set(fd.calls.map((x) => x.method))].sort(), ["getJob", "listEmployees", "listJobsInWindow"]);
resetJobWatchCache();
res = await checkJobs(fakeApi({ pages: [{ jobs: [fin(20, { notes: ["Done"] }), job({ startedAgo: 75 })], page: 1, totalPages: 1, totalItems: 2 }] }).api, NOW, DEFAULT_RULES, helpers);
check("L40 one answer carries both: the overtime alerts and the finished jobs, and the rule for how long finishes are announced", res.ok && res.alerts.length === 1 && res.completed.length === 1 && res.rules.completedHours === 3, JSON.stringify(res));

// ================= K. it works the same wherever the server runs =================
console.log(`TZ=${process.env.TZ ?? "(default)"}`);
// ---- the link to the job in Housecall Pro ("Go to job")
const JID = "job_222bc7db334e4898992bffe4b472bf00";
eq("U1 the default link is the real HCP job page for that job id", jobUrl(undefined, JID), "https://pro.housecallpro.com/app/jobs/job_222bc7db334e4898992bffe4b472bf00");
eq("U2 the default template is the one the user's real HCP link uses", DEFAULT_JOB_URL_TEMPLATE, "https://pro.housecallpro.com/app/jobs/{id}");
eq("U3 a custom https template is used", jobUrl("https://example.test/j/{id}/view", JID), `https://example.test/j/${JID}/view`);
for (const [name, bad] of [["http, not https", "http://pro.housecallpro.com/app/jobs/{id}"], ["no {id}", "https://pro.housecallpro.com/app/jobs/"], ["two {id}", "https://x.test/{id}/{id}"], ["a space", "https://x.test/a b/{id}"], ["javascript:", "javascript:alert(1)//{id}"], ["empty", ""], ["another brace", "https://x.test/{foo}/{id}"], ["a newline", "https://x.test/\n{id}"]] as const) {
  eq(`U4 a bad template (${name}) is ignored and the default is used`, jobUrl(bad, JID), "https://pro.housecallpro.com/app/jobs/" + JID);
}
eq("U5 readWatchRules takes HCP_JOB_URL_TEMPLATE when it is valid", readWatchRules({ HCP_JOB_URL_TEMPLATE: "https://x.test/{id}" }).jobUrlTemplate, "https://x.test/{id}");
eq("U6 ...and falls back to the default when it is not", readWatchRules({ HCP_JOB_URL_TEMPLATE: "ftp://x.test/{id}" }).jobUrlTemplate, DEFAULT_JOB_URL_TEMPLATE);
eq("U7 validJobUrlTemplate says null for nonsense and the text for a good one", [validJobUrlTemplate("nope"), validJobUrlTemplate(" https://a.test/{id} ")], [null, "https://a.test/{id}"]);
for (const odd of ["", "a/b", "job id", "../x", "job?x=1", "x#y", "a".repeat(81), 42, null, undefined, "job_\u0000"] as unknown[]) {
  eq(`U8 an id that is not safe in a web address (${JSON.stringify(odd)}) gives no link`, jobUrl(undefined, odd), null);
}
eq("U9 an id with characters that need escaping is escaped, never trusted raw", jobUrl("https://x.test/{id}", "a-b_c"), "https://x.test/a-b_c");
// the links in the answer: both kinds of bar carry one, and it holds nothing but the job id
{
  const rules = readWatchRules({});
  const nameBy = new Map([["pro_a", "Alex Tech"]]);
  const when = new Date("2026-10-13T20:00:00Z");
  const agoIso = (m: number) => new Date(when.getTime() - m * 60_000).toISOString();
  const jobs = [
    { id: JID, work_status: "in progress", assigned_employees: [{ id: "pro_a" }], work_timestamps: { started_at: agoIso(100) }, job_fields: { job_type: { name: "Garage Door Install" } }, customer: { first_name: "Jane" }, address: { street: "12 Secret Ln" } },
    { id: "job_" + "d".repeat(32), work_status: "complete rated", assigned_employees: [{ id: "pro_a" }], work_timestamps: { started_at: agoIso(85), completed_at: agoIso(20) }, notes: [{ content: "done" }] },
    { id: "bad id/with slash", work_status: "in progress", assigned_employees: [{ id: "pro_a" }], work_timestamps: { started_at: agoIso(100) } },
  ] as unknown as HcpJob[];
  const sum = evaluateJobs(jobs, nameBy, when, rules, { timeZone: () => "America/Chicago", isCanceled });
  const a = sum.alerts.find((x) => x.jobId === JID)!;
  eq("U10 an overtime alert carries the job's page", a.url, "https://pro.housecallpro.com/app/jobs/" + JID);
  eq("U11 a finished-job notification carries its job's page", sum.completed[0].url, "https://pro.housecallpro.com/app/jobs/job_" + "d".repeat(32));
  eq("U12 a job whose id is not safe still alerts, just without a link", sum.alerts.find((x) => x.jobId === "bad id/with slash")!.url, null);
  eq("U13 the link holds no customer detail", JSON.stringify([a.url, sum.completed[0].url]).match(/Jane|Secret|Customer/), null);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
