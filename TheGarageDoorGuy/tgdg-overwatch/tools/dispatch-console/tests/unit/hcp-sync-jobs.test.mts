// @ts-nocheck
import {
  employeeToTechnician, jobToAppointmentRows, extractJobIds,
  syncEmployees, syncJobsWindow, syncSingleJob, retireDemoTechnician,
  type Db, type HcpApi, type HcpEmployee, type HcpJob, type JobsPage,
} from "../../src/lib/hcp-sync.ts";

let failures = 0, passes = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${name}${detail ? "  <- " + detail : ""}`); } };
const eq = (name: string, a: unknown, b: unknown) => check(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);

// ---------- fixtures from the REAL shapes the probe printed ----------
const E = (id: string, first: string, last: string, role: string): HcpEmployee => ({ id: `pro_${id.padEnd(32, "0")}`, first_name: first, last_name: last, role });
const EMPLOYEES: HcpEmployee[] = [
  E("a1", "Jasen", "Burkett", "admin"), E("a2", "Rick", "Blair", "admin"), E("b1", "Drayton", "Wilson", "field tech"),
  E("b2", "Chris", "Parkman", "field tech"), E("b3", "Braden", "Lewis", "field tech"), E("b4", "Stoney", "Wade", "field tech"),
  E("b5", "Josh", "Bayliss", "field tech"), E("c1", "Brooke", "Macks", "office staff"), E("b6", "Justin", "Banks", "field tech"),
  E("b7", "Matthew", "Tucker", "field tech"), E("a3", "Lonni", "Taylor", "admin"), E("a4", "Kris", "Taylor", "admin"),
];
const id = (name: string) => EMPLOYEES.find((e) => e.first_name === name)!.id;
const jobId = (n: number) => `job_${String(n).padStart(32, "0")}`;
const NOW = new Date("2026-10-05T15:00:00Z");
const day = (d: number, h: number) => new Date(NOW.getTime() + d * 86400000 + (h - 15) * 3600000).toISOString();
const J = (n: number, tech: string[], startDay = 1, startHour = 15, status = "scheduled", extra: Partial<HcpJob> = {}): HcpJob => ({
  id: jobId(n), work_status: status, canceled_at: null, deleted_at: null,
  schedule: { scheduled_start: day(startDay, startHour), scheduled_end: day(startDay, startHour + 2) },
  assigned_employees: tech.map((t) => ({ id: id(t) })), address: { zip: "72201" }, ...extra,
});
const FROM = new Date(NOW.getTime() - 86400000), TO = new Date(NOW.getTime() + 21 * 86400000);

// ---------- fakes ----------
type W = Record<string, any>;
function match(row: W, where: W): boolean {
  return Object.entries(where).every(([k, cond]) => {
    const v = row[k];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      if ("notIn" in cond) return !cond.notIn.includes(v);
      if ("lt" in cond) return v < cond.lt;
      if ("gte" in cond || "lte" in cond) return (!("gte" in cond) || v >= cond.gte) && (!("lte" in cond) || v <= cond.lte);
    }
    return v === cond;
  });
}
function fakeDb() {
  const t = { technicians: [] as W[], appts: [] as W[], zips: [] as W[], events: [] as W[], n: 0 };
  const db: Db = {
    technician: {
      async findMany(args: W) { return t.technicians.filter((r) => match(r, args.where ?? {})).map((r) => ({ ...r })) as any; },
      async upsert(args: W) { const ex = t.technicians.find((r) => r.hcpEmployeeId === args.where.hcpEmployeeId); if (ex) Object.assign(ex, args.update); else t.technicians.push({ id: `t${++t.n}`, ...args.create }); },
      async updateMany(args: W) { const rows = t.technicians.filter((r) => match(r, args.where)); rows.forEach((r) => Object.assign(r, args.data)); return { count: rows.length }; },
    },
    appointment: {
      async upsert(args: W) { const k = args.where.hcpJobId_technicianId; const ex = t.appts.find((r) => r.hcpJobId === k.hcpJobId && r.technicianId === k.technicianId); if (ex) Object.assign(ex, args.update); else t.appts.push({ ...args.create }); },
      async deleteMany(args: W) { const before = t.appts.length; t.appts = t.appts.filter((r) => !match(r, args.where)); return { count: before - t.appts.length }; },
      async count(args: W) { return t.appts.filter((r) => match(r, args.where)).length; },
    },
    webhookEvent: { async findUnique() { return null; }, async upsert() {}, async update() {} },
  };
  return { db, t };
}
function fakeHcp(employees: HcpEmployee[], jobs: HcpJob[], opts: { ignoreFilter?: boolean; pageLimit?: number } = {}): HcpApi & { requested: number } {
  const api: any = {
    requested: 0,
    async listEmployees() { return employees; },
    async *listJobsInWindow(from: Date, to: Date, o: { pageSize: number }): AsyncGenerator<JobsPage> {
      const matching = opts.ignoreFilter ? jobs : jobs.filter((j) => { const s = new Date(j.schedule!.scheduled_start!); return s >= from && s <= to; });
      const size = Math.min(o.pageSize, opts.pageLimit ?? o.pageSize);
      const totalPages = Math.max(1, Math.ceil(matching.length / size));
      for (let p = 1; p <= totalPages; p++) { api.requested++; yield { jobs: matching.slice((p - 1) * size, p * size), page: p, totalPages, totalItems: opts.ignoreFilter ? 40146 : matching.length }; }
    },
    async getJob(i: string) { return jobs.find((j) => j.id === i) ?? null; },
  };
  return api;
}

// ================= A. pure mapping =================
{
  const real: HcpJob = { id: "job_8d271fe9249140ec9783c6ff71b77847", work_status: "complete unrated", canceled_at: null, deleted_at: null,
    schedule: { scheduled_start: "2026-10-04T01:00:00Z", scheduled_end: "2026-10-04T03:00:00Z" },
    assigned_employees: [{ id: "pro_b2f6f83c47b94f3f9adbbeed4fec063b" }], address: { zip: "72201" } };
  const m = jobToAppointmentRows(real);
  eq("real job: one row", m.rows.length, 1);
  eq("real job: start UTC", m.rows[0].startTime.toISOString(), "2026-10-04T01:00:00.000Z");
  eq("real job: end UTC (2h block kept as HCP has it)", m.rows[0].endTime.toISOString(), "2026-10-04T03:00:00.000Z");
  eq("real job: tech + zip + status", [m.rows[0].hcpEmployeeId, m.rows[0].zip, m.rows[0].status], ["pro_b2f6f83c47b94f3f9adbbeed4fec063b", "72201", "complete unrated"]);
  eq("two techs -> two rows", jobToAppointmentRows(J(1, ["Drayton", "Chris"])).rows.length, 2);
  eq("duplicate assignee collapsed", jobToAppointmentRows({ ...J(1, ["Drayton"]), assigned_employees: [{ id: id("Drayton") }, { id: id("Drayton") }] }).rows.length, 1);
  eq("canceled_at -> canceled", jobToAppointmentRows(J(1, ["Drayton"], 1, 15, "scheduled", { canceled_at: "2026-10-01T00:00:00Z" })).skip, "canceled");
  eq("deleted_at -> canceled", jobToAppointmentRows(J(1, ["Drayton"], 1, 15, "scheduled", { deleted_at: "2026-10-01T00:00:00Z" })).skip, "canceled");
  eq("status 'user canceled' -> canceled", jobToAppointmentRows(J(1, ["Drayton"], 1, 15, "user canceled")).skip, "canceled");
  eq("null schedule -> unscheduled", jobToAppointmentRows({ ...J(1, ["Drayton"]), schedule: { scheduled_start: null, scheduled_end: null } }).skip, "unscheduled");
  eq("missing schedule object -> unscheduled", jobToAppointmentRows({ ...J(1, ["Drayton"]), schedule: undefined }).skip, "unscheduled");
  eq("end before start -> invalid", jobToAppointmentRows({ ...J(1, ["Drayton"]), schedule: { scheduled_start: day(1, 17), scheduled_end: day(1, 15) } }).skip, "invalid-times");
  eq("garbage date -> unscheduled", jobToAppointmentRows({ ...J(1, ["Drayton"]), schedule: { scheduled_start: "nope", scheduled_end: day(1, 15) } }).skip, "unscheduled");
  eq("no employees -> skip", jobToAppointmentRows(J(1, [])).skip, "no-employees");
  eq("no address -> zip null", jobToAppointmentRows({ ...J(1, ["Drayton"]), address: undefined }).rows[0].zip, null);
  eq("zip+4 from HCP is stored as 5 digits", jobToAppointmentRows({ ...J(1, ["Drayton"]), address: { zip: "72201-1234" } }).rows[0].zip, "72201");
  eq("map point from HCP (strings) is stored as numbers", (({ lat, lng }) => [lat, lng])(jobToAppointmentRows({ ...J(1, ["Drayton"]), address: { zip: "72201", latitude: "34.7465", longitude: "-92.2896" } }).rows[0]), [34.7465, -92.2896]);
  eq("map point given as numbers works too", jobToAppointmentRows({ ...J(1, ["Drayton"]), address: { zip: "72201", latitude: 34.5, longitude: -92.1 } }).rows[0].lat, 34.5);
  eq("no map point -> nulls (the zip is used instead)", (({ lat, lng }) => [lat, lng])(jobToAppointmentRows({ ...J(1, ["Drayton"]), address: { zip: "72201" } }).rows[0]), [null, null]);
  eq("junk or 0,0 map point -> nulls", [jobToAppointmentRows({ ...J(1, ["Drayton"]), address: { latitude: "abc", longitude: "-92" } }).rows[0].lat, jobToAppointmentRows({ ...J(1, ["Drayton"]), address: { latitude: "0", longitude: "0" } }).rows[0].lat, jobToAppointmentRows({ ...J(1, ["Drayton"]), address: { latitude: "", longitude: "" } }).rows[0].lat], [null, null, null]);
  eq("zip with stray spaces is cleaned", jobToAppointmentRows({ ...J(1, ["Drayton"]), address: { zip: "  72204 " } }).rows[0].zip, "72204");
  eq("non-numeric / short zip is stored as null, not junk", [jobToAppointmentRows({ ...J(1, ["Drayton"]), address: { zip: "N/A" } }).rows[0].zip, jobToAppointmentRows({ ...J(1, ["Drayton"]), address: { zip: "7220" } }).rows[0].zip, jobToAppointmentRows({ ...J(1, ["Drayton"]), address: { zip: "" } }).rows[0].zip], [null, null, null]);
  eq("role field tech -> active", employeeToTechnician(E("x", "A", "B", "Field Tech")).active, true);
  eq("role admin -> inactive", employeeToTechnician(E("x", "A", "B", "admin")).active, false);
  eq("role missing -> inactive", employeeToTechnician({ id: "pro_x" }).active, false);
  eq("nameless employee gets a label", employeeToTechnician({ id: "pro_abcdef123456", role: "field tech" }).name, "Employee 123456");
}

// ================= B. extractJobIds =================
{
  const jid = jobId(7);
  eq("flat job_id", extractJobIds({ event: "job.updated", job_id: jid }), [jid]);
  eq("nested job object", extractJobIds({ event: "x", data: { job: { id: jid, customer: { id: "cus_1" } } } }), [jid]);
  eq("appointment event carrying job_id", extractJobIds({ appointment: { id: "appt_" + "0".repeat(32), job_id: jid } }), [jid]);
  eq("ignores pro_/cus_/appt_ ids", extractJobIds({ a: "pro_" + "a".repeat(32), b: "appt_" + "b".repeat(32) }), []);
  eq("dedupes", extractJobIds({ a: jid, b: [jid, { c: jid }] }), [jid]);
  eq("non-object payloads", [extractJobIds(null), extractJobIds("x"), extractJobIds(42)], [[], [], []]);
  eq("caps results", extractJobIds({ list: [1, 2, 3, 4, 5, 6, 7].map((n) => jobId(n)) }, 3).length, 3);
}

// ================= C. employees + jobs sync =================
async function run() {
  // C1. dry run on an empty database writes NOTHING and still reports sensibly
  {
    const { db, t } = fakeDb(); const hcp = fakeHcp(EMPLOYEES, [J(1, ["Drayton"]), J(2, ["Chris"], 2)]);
    const { report, employees } = await syncEmployees({ db, hcp }, { dryRun: true });
    eq("C1 employees total", report.total, 12);
    eq("C1 roles", report.roles, { admin: 4, "field tech": 7, "office staff": 1 });
    eq("C1 active techs = 7 field techs", report.activeTechnicians.length, 7);
    eq("C1 dry run created count", report.created, 12);
    const jr = await syncJobsWindow({ db, hcp }, { from: FROM, to: TO, dryRun: true, employees });
    eq("C1 jobs scanned", jr.jobsScanned, 2);
    eq("C1 rows counted via HCP roster", jr.appointmentRows, 2);
    eq("C1 per tech", jr.perTechnician, { "Drayton Wilson": 1, "Chris Parkman": 1 });
    eq("C1 no unknown employees", jr.unknownEmployees, []);
    check("C1 DB untouched", t.technicians.length === 0 && t.appts.length === 0);
  }

  // C2. real write, idempotency, `active` never overwritten
  {
    const { db, t } = fakeDb(); const jobs = [J(1, ["Drayton"]), J(2, ["Chris", "Braden"], 2), J(3, ["Josh"], 3)];
    const hcp = fakeHcp(EMPLOYEES, jobs);
    const { employees } = await syncEmployees({ db, hcp }, { dryRun: false });
    eq("C2 12 technicians written", t.technicians.length, 12);
    eq("C2 only field techs active", t.technicians.filter((x) => x.active).length, 7);
    const r1 = await syncJobsWindow({ db, hcp }, { from: FROM, to: TO, dryRun: false, employees });
    eq("C2 rows (1 + 2 + 1)", t.appts.length, 4);
    eq("C2 report rows", r1.appointmentRows, 4);
    await syncJobsWindow({ db, hcp }, { from: FROM, to: TO, dryRun: false, employees });
    eq("C2 second run is idempotent", t.appts.length, 4);
    t.technicians.find((x) => x.name === "Jasen Burkett")!.active = true;
    t.technicians.find((x) => x.name === "Drayton Wilson")!.active = false;
    await syncEmployees({ db, hcp }, { dryRun: false });
    check("C2 manual active=true on admin survives re-sync", t.technicians.find((x) => x.name === "Jasen Burkett")!.active === true);
    check("C2 manual active=false on tech survives re-sync", t.technicians.find((x) => x.name === "Drayton Wilson")!.active === false);
    const row = t.appts[0];
    check("C2 stored times are real HCP instants", row.startTime instanceof Date && row.startTime.toISOString() === jobs[0].schedule!.scheduled_start);
  }

  // C3. changes in HCP flow through: reassign, add tech, cancel, move out of window, delete
  {
    const { db, t } = fakeDb(); const jobs = [J(1, ["Drayton"]), J(2, ["Chris"], 2), J(3, ["Josh"], 3), J(4, ["Braden"], 4)];
    const hcp = fakeHcp(EMPLOYEES, jobs); const deps = { db, hcp };
    const { employees } = await syncEmployees(deps, { dryRun: false });
    const sync = () => syncJobsWindow(deps, { from: FROM, to: TO, dryRun: false, employees });
    await sync();
    eq("C3 starts with 4 rows", t.appts.length, 4);

    jobs[0].assigned_employees = [{ id: id("Justin") }]; await sync();
    const j1 = t.appts.filter((r) => r.hcpJobId === jobId(1));
    eq("C3 reassigned: exactly one row", j1.length, 1);
    eq("C3 reassigned: now Justin's", t.technicians.find((x) => x.id === j1[0].technicianId)!.name, "Justin Banks");

    jobs[0].assigned_employees = [{ id: id("Justin") }, { id: id("Matthew") }]; await sync();
    eq("C3 second tech added: two rows", t.appts.filter((r) => r.hcpJobId === jobId(1)).length, 2);

    jobs[1].canceled_at = "2026-10-05T00:00:00Z"; const rCancel = await sync();
    eq("C3 canceled job removed", t.appts.filter((r) => r.hcpJobId === jobId(2)).length, 0);
    eq("C3 cancel counted as skipped", rCancel.skipped.canceled, 1);

    jobs[2].schedule = { scheduled_start: day(40, 15), scheduled_end: day(40, 17) }; const rMoved = await sync();
    eq("C3 job moved beyond window: stale row cleaned", t.appts.filter((r) => r.hcpJobId === jobId(3)).length, 0);
    eq("C3 stale count reported", rMoved.staleRows, 1);

    jobs.splice(3, 1); await sync();
    eq("C3 job gone from HCP: row cleaned", t.appts.filter((r) => r.hcpJobId === jobId(4)).length, 0);
  }

  // C4. safety: empty result must NOT wipe the window; ignored filter must abort
  {
    const { db, t } = fakeDb(); const jobs = [J(1, ["Drayton"]), J(2, ["Chris"], 2)];
    const hcp = fakeHcp(EMPLOYEES, jobs); const deps = { db, hcp };
    const { employees } = await syncEmployees(deps, { dryRun: false });
    await syncJobsWindow(deps, { from: FROM, to: TO, dryRun: false, employees });
    eq("C4 seeded 2 rows", t.appts.length, 2);
    const empty = fakeHcp(EMPLOYEES, []);
    const r = await syncJobsWindow({ db, hcp: empty }, { from: FROM, to: TO, dryRun: false, employees });
    eq("C4 empty HCP result: rows preserved", t.appts.length, 2);
    eq("C4 empty HCP result: no stale deletion", r.staleRows, 0);
    let threw = "";
    try { await syncJobsWindow({ db, hcp: fakeHcp(EMPLOYEES, jobs, { ignoreFilter: true }) }, { from: FROM, to: TO, dryRun: false, employees }); } catch (e) { threw = (e as Error).message; }
    check("C4 ignored date filter aborts", /date filter was probably ignored/.test(threw), threw);
    eq("C4 abort touched nothing", t.appts.length, 2);
  }

  // C5. pagination + unknown employee
  {
    const { db, t } = fakeDb(); const many = Array.from({ length: 23 }, (_, i) => J(100 + i, [["Drayton", "Chris", "Braden"][i % 3]], 1 + (i % 5), 8 + (i % 4)));
    const stranger: HcpJob = { ...J(999, ["Drayton"]), assigned_employees: [{ id: "pro_" + "f".repeat(32) }] };
    const hcp = fakeHcp(EMPLOYEES, [...many, stranger], { pageLimit: 5 }); const deps = { db, hcp };
    const { employees } = await syncEmployees(deps, { dryRun: false });
    const r = await syncJobsWindow(deps, { from: FROM, to: TO, dryRun: false, employees, pageSize: 5 });
    eq("C5 all 5 pages fetched (24 jobs / 5)", r.pagesFetched, 5);
    eq("C5 23 known rows written", t.appts.length, 23);
    eq("C5 stranger reported, not written", r.unknownEmployees, ["pro_" + "f".repeat(32)]);
  }

  // C6. single-job sync (the webhook path)
  {
    const { db, t } = fakeDb(); const jobs = [J(1, ["Drayton"])];
    const hcp = fakeHcp(EMPLOYEES, jobs); const deps = { db, hcp };
    await syncEmployees(deps, { dryRun: false });
    eq("C6 syncs a job", (await syncSingleJob(deps, jobId(1))).result, "synced 1 technician row(s)");
    eq("C6 row exists", t.appts.length, 1);
    jobs[0].assigned_employees = [{ id: id("Chris") }];
    await syncSingleJob(deps, jobId(1));
    eq("C6 reassign via webhook: still one row, now Chris", [t.appts.length, t.technicians.find((x) => x.id === t.appts[0].technicianId)!.name], [1, "Chris Parkman"]);
    jobs.splice(0, 1);
    eq("C6 job deleted in HCP", (await syncSingleJob(deps, jobId(1))).result, "removed (job no longer exists in HCP)");
    eq("C6 rows cleared", t.appts.length, 0);
    // new hire: exists in HCP's roster but not yet in our table
    const fresh = fakeDb(); const hire = [...EMPLOYEES, E("n1", "New", "Hire", "field tech")];
    const hcp2 = fakeHcp(hire, [{ ...J(5, []), assigned_employees: [{ id: hire.at(-1)!.id }] }]);
    await syncEmployees({ db: fresh.db, hcp: fakeHcp(EMPLOYEES, []) }, { dryRun: false });
    const res = await syncSingleJob({ db: fresh.db, hcp: hcp2 }, jobId(5));
    eq("C6 new hire resolved by refreshing the roster", [res.result, fresh.t.appts.length], ["synced 1 technician row(s)", 1]);
    const cancelJob = J(6, ["Drayton"], 1, 15, "scheduled", { canceled_at: "2026-10-05T00:00:00Z" });
    await syncSingleJob({ db, hcp: fakeHcp(EMPLOYEES, [J(6, ["Drayton"])]) }, jobId(6));
    eq("C6 canceled-in-HCP clears rows", (await syncSingleJob({ db, hcp: fakeHcp(EMPLOYEES, [cancelJob]) }, jobId(6))).result, "cleared (canceled)");
    eq("C6 and none left", t.appts.filter((r) => r.hcpJobId === jobId(6)).length, 0);
  }

  // C7. HCP role stored + demo retirement
  {
    const { db, t } = fakeDb(); const hcp = fakeHcp(EMPLOYEES, []);
    await syncEmployees({ db, hcp }, { dryRun: false });
    eq("C7 HCP role stored on each technician", [t.technicians.find((x) => x.name === "Drayton Wilson")!.hcpRole, t.technicians.find((x) => x.name === "Jasen Burkett")!.hcpRole, t.technicians.find((x) => x.name === "Brooke Macks")!.hcpRole], ["field tech", "admin", "office staff"]);
    t.technicians.find((x) => x.name === "Drayton Wilson")!.hcpRole = "stale";
    await syncEmployees({ db, hcp }, { dryRun: false });
    eq("C7 HCP role refreshed by a later sync", t.technicians.find((x) => x.name === "Drayton Wilson")!.hcpRole, "field tech");
    check("C7 sync never sets a classification", t.technicians.every((x) => x.classification === undefined));
    t.technicians.push({ id: "tdemo", hcpEmployeeId: "demo-tech-1", name: "Jordan (Demo Tech)", active: true });
    check("C7 sync never touches an existing classification", (() => { t.technicians.find((x) => x.name === "Jasen Burkett")!.classification = "hybrid"; return true; })());
    await syncEmployees({ db, hcp }, { dryRun: false });
    eq("C7 a later sync leaves the business's classification alone", t.technicians.find((x) => x.name === "Jasen Burkett")!.classification, "hybrid");
    eq("C7 demo retirement (dry) does nothing", await retireDemoTechnician(db, { dryRun: true }), 0);
    eq("C7 demo retired", [await retireDemoTechnician(db, { dryRun: false }), t.technicians.find((x) => x.id === "tdemo")!.active], [1, false]);
  }

  // C8. forward-looking only: past rows are pruned, outside-window jobs are ignored
  {
    const { db, t } = fakeDb(); const hcp = fakeHcp(EMPLOYEES, [J(1, ["Drayton"])]); const deps = { db, hcp };
    const { employees } = await syncEmployees(deps, { dryRun: false });
    const techId = t.technicians.find((x) => x.name === "Drayton Wilson")!.id;
    // two leftovers from "yesterday" and one still in progress across the window start
    t.appts.push({ hcpJobId: jobId(50), technicianId: techId, startTime: new Date(NOW.getTime() - 2 * 86400000), endTime: new Date(NOW.getTime() - 2 * 86400000 + 7200000), status: "complete" });
    t.appts.push({ hcpJobId: jobId(51), technicianId: techId, startTime: new Date(FROM.getTime() - 3600000), endTime: new Date(FROM.getTime() - 60000), status: "complete" });
    t.appts.push({ hcpJobId: jobId(52), technicianId: techId, startTime: new Date(FROM.getTime() - 3600000), endTime: new Date(FROM.getTime() + 3600000), status: "in progress" });
    const dry = await syncJobsWindow(deps, { from: FROM, to: TO, dryRun: true, employees });
    eq("C8 dry run reports the past rows it would clear", dry.prunedPast, 2);
    eq("C8 dry run deleted nothing", t.appts.length, 3);
    const wr = await syncJobsWindow(deps, { from: FROM, to: TO, dryRun: false, employees });
    eq("C8 write clears rows that ended before the window", wr.prunedPast, 2);
    check("C8 a job still running across the window start is kept", t.appts.some((r) => r.hcpJobId === jobId(52)));
    check("C8 finished past jobs are gone", !t.appts.some((r) => r.hcpJobId === jobId(50) || r.hcpJobId === jobId(51)));
    check("C8 the upcoming job was written", t.appts.some((r) => r.hcpJobId === jobId(1)));
  }
  {
    const { db, t } = fakeDb(); const window = { from: FROM, to: TO };
    const jobs = [J(60, ["Drayton"], 1), J(61, ["Drayton"], -3), J(62, ["Drayton"], 90)];
    const hcp = fakeHcp(EMPLOYEES, jobs); const deps = { db, hcp };
    await syncEmployees(deps, { dryRun: false });
    eq("C8 webhook for an upcoming job: written", (await syncSingleJob(deps, jobId(60), { window })).result, "synced 1 technician row(s)");
    eq("C8 webhook for a finished past job: ignored", (await syncSingleJob(deps, jobId(61), { window })).result, "cleared (outside-window)");
    eq("C8 webhook for a job 90 days out: ignored", (await syncSingleJob(deps, jobId(62), { window })).result, "cleared (outside-window)");
    eq("C8 only the in-window job is stored", t.appts.map((r) => r.hcpJobId), [jobId(60)]);
    // a job that moves OUT of the window must disappear
    jobs[0].schedule = { scheduled_start: day(90, 15), scheduled_end: day(90, 17) };
    await syncSingleJob(deps, jobId(60), { window });
    eq("C8 job moved out of the window: row removed", t.appts.length, 0);
    // without a window the old behavior is unchanged
    eq("C8 no window given: still syncs", (await syncSingleJob(deps, jobId(61))).result, "synced 1 technician row(s)");
  }
}
await run();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
