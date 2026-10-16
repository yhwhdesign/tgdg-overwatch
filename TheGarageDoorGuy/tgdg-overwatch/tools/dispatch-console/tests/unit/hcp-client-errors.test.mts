import http from "node:http";
import { diagnoseDay } from "../../src/lib/hcp-diagnose.ts";
import { calendarDayBounds, syncWindow } from "../../src/lib/availability.ts";
import { jobToAppointmentRows } from "../../src/lib/hcp-sync.ts";

let passes = 0, failures = 0;
const check = (n: string, ok: boolean, d = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${n}${d ? "  <- " + d : ""}`); } };

const EMP = "pro_" + "a".repeat(32);
const J = (c: string) => "job_" + c.repeat(32);
const iso = (daysFromNow: number, h: number) => new Date(Date.UTC(2026, 9, 6 + daysFromNow, h + 5)).toISOString();   // CDT wall clock, Oct 6 = day 0
const jobs = [
  { id: J("1"), work_status: "scheduled", schedule: { scheduled_start: iso(1, 8), scheduled_end: iso(1, 12) }, assigned_employees: [{ id: EMP }], customer: { first_name: "Zelda" } },     // OK job
  { id: J("2"), work_status: "scheduled", schedule: { scheduled_start: iso(1, 13), scheduled_end: iso(1, 15) }, assigned_employees: [{ id: EMP }] },                                      // HCP says archived
  { id: J("3"), work_status: "scheduled", schedule: { scheduled_start: iso(1, 16), scheduled_end: iso(1, 17) }, assigned_employees: [{ id: EMP }] },                                      // HCP has a hiccup
];
const methods: string[] = [];
const server = http.createServer((req, res) => {
  methods.push(req.method ?? "?");
  const u = new URL(req.url!, "http://x");
  const send = (code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (u.pathname === "/employees") return send(200, { page: 1, total_pages: 1, total_items: 1, employees: [{ id: EMP, first_name: "Drayton", last_name: "Wilson", role: "field tech" }] });
  if (u.pathname === "/jobs") return send(200, { page: 1, total_pages: 1, total_items: jobs.length, jobs });
  if (u.pathname === `/jobs/${J("1")}/appointments`) return send(200, { appointments: [{ id: "appt_1", start_time: iso(1, 8), end_time: iso(1, 12), dispatched_employees_ids: [EMP] }] });
  if (u.pathname === `/jobs/${J("2")}/appointments`) return send(400, { error: { message: "Archived job" } });          // EXACTLY what HCP returned to the user
  if (u.pathname === `/jobs/${J("3")}/appointments`) return send(500, { error: { message: "something broke" } });
  if (u.pathname === "/jobs/job_gone/appointments") return send(404, {});
  if (u.pathname === "/jobs/job_arch") return send(400, { error: { message: "Archived job" } });
  if (u.pathname === "/jobs/job_bad") return send(400, { error: { message: "Something else is wrong" } });
  if (u.pathname === "/jobs/job_boom") return send(500, {});
  if (u.pathname === "/jobs/job_ok") return send(200, { id: "job_ok" });
  send(404, {});
});
await new Promise<void>((r) => server.listen(0, r));
process.env.HCP_BASE_URL = `http://localhost:${(server.address() as any).port}`; process.env.HCP_API_KEY = "k";
const { hcpApi, HcpApiError } = await import("../../src/lib/hcp-client.ts");

// ---- the client classifies HCP's responses
let archived: any = null, other: any = null;
try { await hcpApi.listAppointments(J("2")); } catch (e) { archived = e; }
try { await hcpApi.listAppointments(J("3")); } catch (e) { other = e; }
check("client: 400 'Archived job' -> HcpApiError with archived = true", archived instanceof HcpApiError && archived.archived === true && archived.status === 400, String(archived));
check("client: a 500 -> HcpApiError with archived = false", other instanceof HcpApiError && other.archived === false && other.status === 500, String(other));
check("client: the error message names the endpoint and keeps HCP's wording", /400 on \/jobs\/\{id\}\/appointments/.test(archived.message) && /Archived job/.test(archived.message), archived.message);
check("client: a 404 is still just 'no appointments'", (await hcpApi.listAppointments("job_gone")).length === 0);
check("client: a good job returns its appointments", (await hcpApi.listAppointments(J("1"))).length === 1);

// ---- the live-update path (webhook -> getJob)
check("getJob: an ARCHIVED job counts as gone (null), so the webhook clears its booking", (await hcpApi.getJob("job_arch")) === null);
check("getJob: a 400 that is NOT about archiving still raises an error", await hcpApi.getJob("job_bad").then(() => false, (e) => /400/.test(e.message)));
check("getJob: a server error raises, it is not silently treated as gone", await hcpApi.getJob("job_boom").then(() => false, (e) => /500/.test(e.message)));
check("getJob: a good job comes back", (await hcpApi.getJob("job_ok"))?.id === "job_ok");

// ---- the REAL client through the REAL diagnosis, for tomorrow, against that server
const r = await diagnoseDay({ hcp: hcpApi, timeZone: "America/Chicago", dayBounds: calendarDayBounds, syncWindow: syncWindow(new Date("2026-10-06T15:00:00Z")), mapJob: jobToAppointmentRows,
  loadStored: async () => ({ technicianFound: true, rows: [], latestRowUpdate: null }) }, { name: "Drayton Wilson", date: "2026-10-07" });
// ---- a dropped connection is retried; a network that stays down fails with the real reason
{
  const realFetch = globalThis.fetch;
  let calls = 0, failFirst = 2;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    calls++;
    if (calls <= failFirst) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
    return realFetch(...args);
  }) as typeof fetch;
  let ok: any = null;
  let okErr = ""; try { ok = await hcpApi.listAppointments(J("1")); } catch (e) { okErr = String(e); }
  check("net: two dropped connections are retried and the call still succeeds", calls >= 3 && ok !== null, `calls=${calls} ${okErr}`);

  calls = 0; failFirst = 99;
  let err: any = null;
  try { await hcpApi.listAppointments(J("1")); } catch (e) { err = e; }
  check("net: a network that stays down gives up after 4 tries", calls === 4, `calls=${calls}`);
  check("net: the error names the real cause and still reads as 'could not be reached'", /ECONNRESET/.test(String(err?.message)) && /fetch failed/.test(String(err?.message)), String(err?.message));
  globalThis.fetch = realFetch;
}
server.close();
check("end to end: one archived job and one failing job do NOT stop the report", r.ok === true);
if (r.ok) {
  check("end to end: all three of his jobs are reported", r.items.length === 3, String(r.items.length));
  const byJob = Object.fromEntries(r.items.map((i) => [i.job, i]));
  check("end to end: the archived one is flagged", byJob["222222"].archived === true && byJob["222222"].lookupError === null);
  check("end to end: the hiccup is recorded as a lookup error, not as archived", byJob["333333"].archived === false && /500/.test(byJob["333333"].lookupError ?? ""));
  check("end to end: the good job is unaffected", byJob["111111"].archived === false && byJob["111111"].lookupError === null && byJob["111111"].appointments.length === 1);
  check("end to end: the summary counts them", r.scanned.archivedJobs === 1 && r.scanned.lookupErrors === 1, JSON.stringify(r.scanned));
  check("end to end: still no customer data in the report", !JSON.stringify(r).includes("Zelda"));
}
check("end to end: every request HCP received was a read-only GET", methods.length > 0 && methods.every((m) => m === "GET"), [...new Set(methods)].join());

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
