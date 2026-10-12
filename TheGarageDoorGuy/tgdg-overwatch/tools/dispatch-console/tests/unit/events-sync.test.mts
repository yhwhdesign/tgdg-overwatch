import { eventToRows, syncEventsWindow, syncJobsWindow, syncEmployees, type Db, type HcpApi, type HcpEmployee, type HcpEvent, type HcpJob, type JobsPage } from "../../src/lib/hcp-sync.ts";

let passes = 0, failures = 0;
const check = (n: string, ok: boolean, d = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${n}${d ? "  <- " + d : ""}`); } };
const eq = (n: string, a: unknown, b: unknown) => check(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);

const DRAY = "pro_" + "d".repeat(32), MATT = "pro_" + "e".repeat(32), RICK = "pro_" + "f".repeat(32);
const EMPLOYEES: HcpEmployee[] = [{ id: DRAY, first_name: "Drayton", last_name: "Wilson", role: "field tech" }, { id: MATT, first_name: "Matthew", last_name: "Tucker", role: "field tech" }, { id: RICK, first_name: "Rick", last_name: "Blair", role: "admin" }];
const T = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 9, 8 + day, h + 5, m)).toISOString();   // CDT wall clock; day 0 = Oct 8
const FROM = new Date(Date.UTC(2026, 9, 8, 5)), TO = new Date(Date.UTC(2026, 10, 8, 6));   // Oct 8 00:00 CDT .. Nov 8

// ---------------- A. the reader ----------------
{
  const a = eventToRows({ id: "evt_1", name: "Pick up product", start_time: T(0, 7), end_time: T(0, 8, 30), assigned_employees: [{ id: DRAY }] });
  eq("A1 object-style assignee: one row, stored under event:<id>@<start>", [a.skip, a.rows.length, a.rows[0].hcpEventKey, a.rows[0].hcpEmployeeId, a.rows[0].label], [null, 1, `event:evt_1@${T(0, 7)}`, DRAY, "Pick up product"]);
  eq("A1 times parsed exactly", [a.rows[0].startTime.toISOString(), a.rows[0].endTime.toISOString()], [T(0, 7), T(0, 8, 30)]);
  const b = eventToRows({ id: "evt_2", title: "Team meeting", start: T(0, 9), end: T(0, 10), employee_ids: [DRAY, MATT, DRAY] });
  eq("A2 a different shape (start/end, employee_ids) works, and a repeated id is not doubled", [b.rows.map((r) => r.hcpEmployeeId).sort(), b.rows[0].label], [[DRAY, MATT].sort(), "Team meeting"]);
  const c = eventToRows({ id: "evt_3", name: "Errand", start_time: T(0, 7), end_time: T(0, 8), created_by: RICK, assigned_employees: [{ id: DRAY }] });
  eq("A3 the creator is NOT treated as an assignee", c.rows.map((r) => r.hcpEmployeeId), [DRAY]);
  const d = eventToRows({ id: "evt_4", name: "Errand", start_time: T(0, 7), end_time: T(0, 8), created_by: RICK, updated_by: MATT });
  eq("A4 an event with only a creator is skipped, never attached to the creator", [d.rows.length, d.skip], [0, "no-employees"]);
  const e = eventToRows({ id: "evt_5", name: "Weekly", schedule: { start_time: T(0, 8), end_time: T(0, 9) }, employee_ids: [DRAY] });
  eq("A5 times inside a nested schedule object are found", e.rows.length, 1);
  const f = eventToRows({ id: "evt_6", name: "Weekly sync", start_time: T(0, 8), end_time: T(0, 9), employee_ids: [DRAY], recurrence: { frequency: "weekly", end_date: "2026-12-31T00:00:00Z", until: "2026-12-31T00:00:00Z" } });
  eq("A6 a repeat-series end date is never mistaken for the event's end", [f.rows[0].endTime.toISOString()], [T(0, 9)]);
  const g = eventToRows({ id: "evt_7", name: "Weekly sync", employee_ids: [DRAY], recurrence: { frequency: "weekly", end_date: "2026-12-31T00:00:00Z", start_date: "2026-01-05T00:00:00Z" } });
  eq("A7 with no times of its own, the series dates are NOT used", [g.rows.length, g.skip], [0, "no-times"]);
  eq("A8 all-day events given as plain dates are skipped and named, not guessed", eventToRows({ id: "evt_8", name: "PTO", start_date: "2026-10-09", end_date: "2026-10-09", employee_ids: [DRAY] }).skip, "all-day-dates-only");
  eq("A9 canceled (by timestamp)", eventToRows({ id: "e", name: "x", start_time: T(0, 7), end_time: T(0, 8), employee_ids: [DRAY], canceled_at: "2026-10-01T00:00:00Z" }).skip, "canceled");
  eq("A9 canceled (by status)", eventToRows({ id: "e", name: "x", start_time: T(0, 7), end_time: T(0, 8), employee_ids: [DRAY], status: "Cancelled" }).skip, "canceled");
  eq("A10 end before start", eventToRows({ id: "e", start_time: T(0, 9), end_time: T(0, 8), employee_ids: [DRAY] }).skip, "invalid-times");
  eq("A10 no id", eventToRows({ start_time: T(0, 7), end_time: T(0, 8), employee_ids: [DRAY] }).skip, "no-id");
  eq("A10 unrecognizable shape", eventToRows({ id: "e", foo: "bar", employee_ids: [DRAY] }).skip, "no-times");
  const long = eventToRows({ id: "e", name: "  Pick   up\n door   hardware for the   big commercial install at the warehouse on Main Street  ", start_time: T(0, 7), end_time: T(0, 8), employee_ids: [DRAY] });
  check("A11 title: whitespace collapsed and cut to 60 characters with an ellipsis", long.rows[0].label!.length === 60 && long.rows[0].label!.endsWith("\u2026") && !/\s{2}/.test(long.rows[0].label!), long.rows[0].label ?? "");
  eq("A11 title: name beats description", eventToRows({ id: "e", description: "long text", name: "Short", start_time: T(0, 7), end_time: T(0, 8), employee_ids: [DRAY] }).rows[0].label, "Short");
  eq("A11 no title at all is fine", eventToRows({ id: "e", start_time: T(0, 7), end_time: T(0, 8), employee_ids: [DRAY] }).rows[0].label, null);
}

// ---------------- fakes ----------------
type W = Record<string, any>;
function match(row: W, where: W): boolean {
  return Object.entries(where).every(([k, cond]) => {
    const v = row[k];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      if ("startsWith" in cond) return typeof v === "string" && v.startsWith(cond.startsWith);
      if ("notIn" in cond) return !cond.notIn.includes(v);
      if ("lt" in cond) return v < cond.lt;
      if ("gte" in cond || "lte" in cond) return (!("gte" in cond) || v >= cond.gte) && (!("lte" in cond) || v <= cond.lte);
    }
    return v === cond;
  });
}
function fakeDb() {
  const t = { technicians: [] as W[], appts: [] as W[], n: 0, writes: 0, wheres: [] as W[] };
  const db: Db = {
    technician: {
      async findMany(args: W) { return t.technicians.filter((r) => match(r, args.where ?? {})).map((r) => ({ ...r })) as any; },
      async upsert(a: W) { const ex = t.technicians.find((r) => r.hcpEmployeeId === a.where.hcpEmployeeId); if (ex) Object.assign(ex, a.update); else t.technicians.push({ id: `t${++t.n}`, ...a.create }); },
      async updateMany() { return { count: 0 }; },
    },
    appointment: {
      async upsert(a: W) { t.writes++; const k = a.where.hcpJobId_technicianId; const ex = t.appts.find((r) => r.hcpJobId === k.hcpJobId && r.technicianId === k.technicianId); if (ex) Object.assign(ex, a.update); else t.appts.push({ ...a.create }); },
      async deleteMany(a: W) { t.wheres.push(a.where); const before = t.appts.length; t.appts = t.appts.filter((r) => !match(r, a.where)); t.writes += before - t.appts.length; return { count: before - t.appts.length }; },
      async count(a: W) { t.wheres.push(a.where); return t.appts.filter((r) => match(r, a.where)).length; },
    },
    webhookEvent: { async findUnique() { return null; }, async upsert() {}, async update() {} },
  };
  return { db, t };
}
function fakeHcp(events: HcpEvent[], jobs: HcpJob[] = [], pages?: { count: number; total: number; note?: string }): HcpApi {
  return {
    async listEmployees() { return EMPLOYEES; },
    async *listJobsInWindow(from: Date, to: Date): AsyncGenerator<JobsPage> { const m = jobs.filter((j) => new Date(j.schedule!.scheduled_start!) >= from && new Date(j.schedule!.scheduled_start!) <= to); yield { jobs: m, page: 1, totalPages: 1, totalItems: m.length }; },
    async getJob() { return null; },
    async listAppointments() { return []; },
    async listEvents(_from: Date, _to: Date, opts?: { onPage?: (p: { page: number; totalPages: number; totalItems: number }) => void; onNote?: (m: string) => void }) {
      if (pages) for (let p = 1; p <= pages.count; p++) opts?.onPage?.({ page: p, totalPages: pages.count, totalItems: pages.total });
      if (pages?.note) opts?.onNote?.(pages.note);
      return events;
    },
  };
}
const ev = (id: string, startDay: number, sh: number, eh: number, people: string[], extra: W = {}): HcpEvent => ({ id, name: `Event ${id}`, start_time: T(startDay, sh), end_time: T(startDay, eh), assigned_employees: people.map((p) => ({ id: p })), ...extra });
const names = (t: { appts: W[]; technicians: W[] }) => t.appts.map((r) => `${String(r.hcpJobId).replace(/@.*$/, "")}|${t.technicians.find((x) => x.id === r.technicianId)?.name}|${r.kind}`).sort();

(async () => {
  // ---------------- B. the sync ----------------
  {
    const { db, t } = fakeDb(); const events = [ev("evt_a", 1, 7, 8, [DRAY], { name: "Pick up product" }), ev("evt_b", 2, 9, 10, [DRAY, MATT])];
    const hcp = fakeHcp(events); const deps = { db, hcp };
    const { employees } = await syncEmployees(deps, { dryRun: false });
    const dry = await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: true, employees });
    eq("B1 dry run: counts", [dry.fetched, dry.usable, dry.rows, dry.perTechnician], [2, 2, 3, { "Drayton Wilson": 2, "Matthew Tucker": 1 }]);
    check("B1 dry run wrote nothing", t.appts.length === 0);
    check("B1 the sample carries the title", dry.sample.some((s) => s.label === "Pick up product"));
    const w = await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: false, employees });
    eq("B2 write: three rows, all marked as events", [t.appts.length, t.appts.every((r) => r.kind === "event" && r.status === "event" && r.zip === null)], [3, true]);
    eq("B2 stored under the event: prefix, with the title", [t.appts.every((r) => r.hcpJobId.startsWith("event:")), t.appts.find((r) => r.hcpJobId.startsWith("event:evt_a@")).label], [true, "Pick up product"]);
    await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: false, employees });
    eq("B3 re-running changes nothing (no duplicates)", t.appts.length, 3);
    // title edited, a person removed, a person added
    events[0].name = "Pick up door hardware"; events[1].assigned_employees = [{ id: MATT }, { id: RICK }];
    await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: false, employees });
    eq("B4 an edited title updates in place", t.appts.find((r) => r.hcpJobId.startsWith("event:evt_a@")).label, "Pick up door hardware");
    eq("B4 someone taken off an event loses the row; someone added gains one", names(t).filter((n) => n.startsWith("event:evt_b")), ["event:evt_b|Matthew Tucker|event", "event:evt_b|Rick Blair|event"]);
    // deleted in HCP
    events.splice(1, 1);
    const r5 = await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: false, employees });
    eq("B5 an event removed in HCP is cleaned up", [r5.staleRows, names(t)], [2, ["event:evt_a|Drayton Wilson|event"]]);
  }
  {
    // job cleanup and event cleanup never touch each other
    const { db, t } = fakeDb();
    const job: HcpJob = { id: "job_" + "1".repeat(32), work_status: "scheduled", schedule: { scheduled_start: T(1, 8), scheduled_end: T(1, 12) }, assigned_employees: [{ id: DRAY }] };
    const events = [ev("evt_a", 1, 7, 8, [DRAY])];
    const deps = { db, hcp: fakeHcp(events, [job]) };
    const { employees } = await syncEmployees(deps, { dryRun: false });
    await syncJobsWindow(deps, { from: FROM, to: TO, dryRun: false, employees });
    await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: false, employees });
    eq("B6 a job and an event both stored", names(t), ["event:evt_a|Drayton Wilson|event", `${job.id}|Drayton Wilson|job`].sort());
    await syncJobsWindow(deps, { from: FROM, to: TO, dryRun: false, employees });
    check("B6 running the JOB sync again does not delete the event", names(t).some((n) => n.startsWith("event:")), names(t).join());
    events.length = 0; events.push(ev("evt_other", 3, 9, 10, [MATT]));
    await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: false, employees });
    check("B6 running the EVENT sync (even when its events change) does not delete the job", names(t).some((n) => n.includes("|job")), names(t).join());
  }
  {
    // empty answer must not wipe
    const { db, t } = fakeDb(); const events = [ev("evt_a", 1, 7, 8, [DRAY])]; const deps = { db, hcp: fakeHcp(events) };
    const { employees } = await syncEmployees(deps, { dryRun: false });
    await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: false, employees });
    events.length = 0;
    const r = await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: false, employees });
    eq("B7 HCP returning zero events does NOT wipe the ones we hold", [t.appts.length, r.staleRows], [1, 0]);
  }
  {
    // window rules
    const { db, t } = fakeDb(); const deps = { db, hcp: fakeHcp([
      ev("evt_past", -3, 9, 10, [DRAY]),                                                      // already over
      ev("evt_far", 60, 9, 10, [DRAY]),                                                       // beyond the window
      { id: "evt_running", name: "Training week", start_time: T(-2, 8), end_time: T(1, 17), assigned_employees: [{ id: DRAY }] },   // began before, still running
    ]) };
    const { employees } = await syncEmployees(deps, { dryRun: false });
    const r = await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: false, employees });
    eq("B8 only events overlapping the window are kept, including one already under way", names(t), ["event:evt_running|Drayton Wilson|event"]);
  }
  {
    // unknown people / canceled / unreadable, and privacy of the report
    const { db, t } = fakeDb();
    const stranger = "pro_" + "9".repeat(32);
    const events: HcpEvent[] = [
      ev("evt_ok", 1, 7, 8, [DRAY]),
      ev("evt_ghost", 1, 9, 10, [stranger]),
      ev("evt_cancel", 1, 11, 12, [DRAY], { canceled_at: "2026-10-01T00:00:00Z" }),
      { id: "evt_weird", name: "Zelda Quimby gate code 4471", location: "742 Evergreen Terrace", employee_ids: [DRAY] },
      { id: "evt_dates", name: "PTO", start_date: "2026-10-09", end_date: "2026-10-09", employee_ids: [DRAY] },
    ];
    const deps = { db, hcp: fakeHcp(events) };
    const { employees } = await syncEmployees(deps, { dryRun: false });
    await db.appointment.upsert({ where: { hcpJobId_technicianId: { hcpJobId: `event:evt_cancel@${T(1, 11)}`, technicianId: t.technicians.find((x) => x.name === "Drayton Wilson")!.id } }, update: {}, create: { hcpJobId: `event:evt_cancel@${T(1, 11)}`, technicianId: t.technicians.find((x) => x.name === "Drayton Wilson")!.id, startTime: new Date(T(1, 11)), endTime: new Date(T(1, 12)), status: "event", kind: "event", label: "x", zip: null } });
    const r = await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: false, employees });
    eq("B9 counts: 1 stored, the canceled/all-day/unreadable ones skipped", [r.rows, r.skipped], [1, { canceled: 1, "no-times": 1, "all-day-dates-only": 1 }]);
    eq("B9 an unknown person is reported, not written", r.unknownEmployees, [stranger]);
    check("B9 a canceled event's old row is removed", !t.appts.some((x) => x.hcpJobId.startsWith("event:evt_cancel@")));
    eq("B9 unreadable events are listed with their reason and FIELD NAMES", r.unreadable.map((u) => [u.event, u.reason]).sort(), [["_dates", "all-day-dates-only"], ["_weird", "no-times"]].sort());
    check("B9 field names are given (to fix the reader), personal text never", r.unreadable.find((u) => u.event === "_weird")!.fields.includes("location") && !JSON.stringify(r).includes("Zelda") && !JSON.stringify(r).includes("Evergreen") && !JSON.stringify(r).includes("4471"), JSON.stringify(r.unreadable));
  }

  // ---------------- C. the REAL shape, rebuilt from the user's probe output ----------------
  {
    const person = (id: string, first: string, last: string) => ({
      id, first_name: first, last_name: last, email: "x@example.com", mobile_number: "5015550101", color_hex: "5d4037", avatar_url: "https://example.com/a.png", role: "field tech", tags: [],
      permissions: { can_add_and_edit_job: true, can_call_and_text_with_customers: true, can_chat_with_customers: true, can_delete_and_cancel_job: false, can_edit_message_on_invoice: true, can_see_street_view_data: true, can_take_payment_see_prices: true, can_see_customers: true, can_see_marketing_campaigns: false, can_see_reporting: false, can_edit_settings: false, can_be_booked_online: true, can_share_job: true, can_see_full_schedule: true, can_see_future_jobs: true, is_point_of_contact: false, is_admin: false },
      created_at: "2025-11-07T14:16:27Z", company_name: "The Garage Door Guy Corp", company_id: "cmp_" + "a".repeat(32),
    });
    const JUSTIN = "pro_" + "1".repeat(32), CHRIS = "pro_21a1457ce67147f7ac3b5cfd172c892d", GHOST = "pro_8aee539447164676b4648a6069a0c5a0";
    const real = (id: string, name: string, start: string, end: string, people: ReturnType<typeof person>[], extra: W = {}): HcpEvent => ({
      id, name, note: "bring the van", tags: [], recurrence_rule: null,
      address: { street: null, street_line_2: null, city: null, state: null, zip: null },
      assigned_employees: people, schedule: { start_time: start, end_time: end, time_zone: "America/Chicago" }, all_day: false,
      created_at: "2026-10-07T19:10:41Z", updated_at: "2026-10-07T19:10:41Z", company_name: "The Garage Door Guy Corp", company_id: "cmp_" + "a".repeat(32), ...extra,
    });
    // the product pickup the user described: Thu Oct 8, 8:00-9:00 AM, Drayton + Justin
    const pickup = real("evt_6a7fa2" + "0".repeat(26), "Pick up product", "2026-10-08T13:00:00Z", "2026-10-08T14:00:00Z", [person(DRAY, "Drayton", "Wilson"), person(JUSTIN, "Justin", "Banks")]);
    const r = eventToRows(pickup);
    eq("C1 the real shape parses: two people, the exact hours, the title", [r.skip, r.rows.map((x) => x.hcpEmployeeId).sort(), r.rows[0].startTime.toISOString(), r.rows[0].endTime.toISOString(), r.rows[0].label], [null, [DRAY, JUSTIN].sort(), "2026-10-08T13:00:00.000Z", "2026-10-08T14:00:00.000Z", "Pick up product"]);
    const big = eventToRows(real("evt_" + "b".repeat(32), "Team meeting", "2026-10-07T11:45:00Z", "2026-10-07T12:00:00Z", [person(DRAY, "Drayton", "Wilson"), person(CHRIS, "Chris", "Parkman"), person(MATT, "Matthew", "Tucker"), person(RICK, "Rick", "Blair"), person(GHOST, "Former", "Person")]));
    eq("C2 a team event reads every person, including one we don't know (reported later, not guessed)", big.rows.map((x) => x.hcpEmployeeId).sort(), [DRAY, CHRIS, MATT, RICK, GHOST].sort());
    check("C3 nothing from the permission blocks or company ids leaks in as a person", big.rows.every((x) => /^pro_[0-9a-f]{32}$/.test(x.hcpEmployeeId)) && big.rows.length === 5);
    eq("C4 a null recurrence_rule is harmless", eventToRows(pickup).skip, null);
    const longEvt = eventToRows(real("evt_" + "c".repeat(32), "Labor Day", "2026-09-07T13:00:00Z", "2026-09-07T22:00:00Z", [person(DRAY, "Drayton", "Wilson")], { all_day: true }));
    eq("C5 an all_day event that still carries real times is read from those times", [longEvt.skip, longEvt.rows[0].startTime.toISOString(), longEvt.rows[0].endTime.toISOString()], [null, "2026-09-07T13:00:00.000Z", "2026-09-07T22:00:00.000Z"]);

    // a first page like the one the user got: HCP ignores the dates, so most events are old; only the ones in the window may be kept
    const { db, t } = fakeDb();
    const page: HcpEvent[] = [
      pickup,                                                                                                                       // Oct 8: in the window
      real("evt_" + "d".repeat(32), "Team meeting", "2026-10-07T11:45:00Z", "2026-10-07T12:00:00Z", [person(DRAY, "Drayton", "Wilson")]),   // Oct 7 (yesterday, over)
      real("evt_" + "e".repeat(32), "Meeting", "2026-08-28T12:00:00Z", "2026-08-28T13:00:00Z", [person(DRAY, "Drayton", "Wilson")]),       // six weeks ago
      real("evt_" + "f".repeat(32), "Meeting", "2026-10-16T12:30:00Z", "2026-10-16T13:30:00Z", [person(DRAY, "Drayton", "Wilson"), person(MATT, "Matthew", "Tucker")]), // next week, in the window
    ];
    const deps = { db, hcp: fakeHcp(page) };
    const { employees } = await syncEmployees(deps, { dryRun: false });
    const rep = await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: false, employees });
    eq("C6 four events fetched but only the two that fall inside the window are stored (older ones ignored)", [rep.fetched, rep.usable, rep.rows], [4, 2, 3]);
    eq("C6 stored: the pickup for Drayton (Justin is not in this test roster, so he is reported, not guessed) plus next week's event for both", [names(t).length, rep.unknownEmployees], [3, [JUSTIN]]);
    check("C7 the pickup is stored for Drayton with its title", t.appts.some((r) => r.hcpJobId.startsWith("event:evt_6a7fa2") && r.label === "Pick up product" && r.kind === "event" && t.technicians.find((x) => x.id === r.technicianId)?.name === "Drayton Wilson"));
  }

  // ---------------- D. repeating events, duplicates, stats, richer unreadable report ----------------
  {
    // a series: ONE id, three different occurrences. Every occurrence must be kept.
    const { db, t } = fakeDb();
    const series = [ev("evt_series", 1, 9, 10, [DRAY], { name: "Weekly thing" }), ev("evt_series", 8, 9, 10, [DRAY], { name: "Weekly thing" }), ev("evt_series", 15, 9, 10, [DRAY], { name: "Weekly thing" })];
    const events = [...series, ev("evt_series", 8, 9, 10, [DRAY], { name: "Weekly thing" })];   // plus an exact copy of occurrence 2
    const deps = { db, hcp: fakeHcp(events) };
    const { employees } = await syncEmployees(deps, { dryRun: false });
    const r = await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: false, employees });
    eq("D1 three occurrences of one id are all kept, as separate rows", t.appts.length, 3);
    eq("D1 the report counts: 4 entries, 1 distinct id, 3 repeats of an earlier id", [r.fetched, r.distinct, r.duplicateEntries], [4, 1, 3]);
    eq("D2 an exact copy is not counted twice (3 distinct occurrences, 3 rows)", [r.usable, r.rows], [3, 3]);
    // one occurrence disappears in HCP
    events.splice(3, 1); events.splice(1, 1);   // remove occurrence 2 AND its exact copy; occurrences 1 and 3 remain
    const r3 = await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: false, employees });
    eq("D3 when one occurrence disappears only that one is cleaned up", [t.appts.length, r3.staleRows], [2, 1]);
    // the time of an occurrence is edited
    events[0].start_time = T(1, 11); events[0].end_time = T(1, 12);
    await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: false, employees });
    eq("D4 an edited time replaces the old row instead of leaving a ghost", t.appts.map((x) => x.startTime.toISOString()).sort(), [T(1, 11), T(15, 9)].sort());
    // canceling removes every occurrence
    for (const e of events) e.canceled_at = "2026-10-08T00:00:00Z";
    await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: false, employees });
    eq("D5 a canceled series loses every occurrence", t.appts.length, 0);
  }
  {
    // richer report for events we cannot read
    const { db } = fakeDb();
    const odd: HcpEvent = { id: "evt_" + "9".repeat(26) + "abc123", name: "Zelda's gate code 4471", note: "742 Evergreen", all_day: true, recurrence_rule: "FREQ=WEEKLY;BYDAY=MO", created_at: "2026-09-01T12:00:00Z", start_time: T(1, 2), end_time: T(1, 0), assigned_employees: [{ id: DRAY }, { id: MATT }, { id: RICK }] };
    const deps = { db, hcp: fakeHcp([odd]) };
    const { employees } = await syncEmployees(deps, { dryRun: false });
    const r = await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: true, employees });
    const u = r.unreadable[0];
    eq("D6 an unreadable event explains itself: its times, all-day flag, repeat rule, headcount and age", [u.event, u.reason, u.start, u.end, u.allDay, u.recurrenceRule, u.assigned, u.createdAt], ["abc123", "invalid-times", T(1, 2), T(1, 0), true, "FREQ=WEEKLY;BYDAY=MO", 3, "2026-09-01T12:00:00Z"]);
    check("D6 ...and still shows no title, note, address or person", !JSON.stringify(r).includes("Zelda") && !JSON.stringify(r).includes("4471") && !JSON.stringify(r).includes("Evergreen") && !JSON.stringify(r).includes(DRAY));
  }
  {
    // reading stats and progress lines
    const { db } = fakeDb(); const logs: string[] = [];
    const deps = { db, hcp: fakeHcp([ev("evt_a", 1, 7, 8, [DRAY])], [], { count: 3, total: 250 }) };
    const { employees } = await syncEmployees(deps, { dryRun: false });
    const r = await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: true, employees, log: (m) => logs.push(m) });
    eq("D7 the report says how many pages were read, the total HCP has, and how long it took", [r.pages, r.totalItems, typeof r.seconds], [3, 250, "number"]);
    eq("D7 progress lines were produced for the server window", logs, ["[events] read page 1 of 3 (250 events in all)", "[events] read page 2 of 3 (250 events in all)", "[events] read page 3 of 3 (250 events in all)"]);
  }
  {
    // the "stale" condition stays small even though thousands of old events were read
    const { db, t } = fakeDb();
    const old = Array.from({ length: 800 }, (_, i) => ev(`evt_old${i}`, -30 - (i % 40), 9, 10, [DRAY]));
    const deps = { db, hcp: fakeHcp([...old, ev("evt_new1", 1, 9, 10, [DRAY]), ev("evt_new2", 2, 9, 10, [DRAY])]) };
    const { employees } = await syncEmployees(deps, { dryRun: false });
    t.wheres.length = 0;
    const r = await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: true, employees });
    const stale = t.wheres.find((w) => w.kind === "event" && w.hcpJobId?.notIn);
    eq("D8 800 old events read, but the cleanup condition lists only the 2 that matter", [r.fetched, r.usable, stale.hcpJobId.notIn.length], [802, 2, 2]);
  }

  // ---------------- E. zero-length events, and explaining how the read went ----------------
  {
    eq("E1 an event whose end is its start has no duration: a quiet skip, not an error", eventToRows({ id: "e", name: "x", start_time: T(1, 7), end_time: T(1, 7), employee_ids: [DRAY] }).skip, "no-duration");
    eq("E1 end BEFORE start is still invalid", eventToRows({ id: "e", name: "x", start_time: T(1, 8), end_time: T(1, 7), employee_ids: [DRAY] }).skip, "invalid-times");
    const { db, t } = fakeDb();
    const zero = (id: string) => ({ id, name: "Reminder", start_time: T(1, 7), end_time: T(1, 7), assigned_employees: [{ id: DRAY }] });
    const deps = { db, hcp: fakeHcp([ev("evt_ok", 1, 9, 10, [DRAY]), zero("evt_z1"), zero("evt_z2")]) };
    const { employees } = await syncEmployees(deps, { dryRun: false });
    const r = await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: false, employees });
    eq("E2 zero-length events are counted as skipped, kept OUT of the unreadable list, and block nothing", [r.skipped, r.unreadable.length, t.appts.length], [{ "no-duration": 2 }, 0, 1]);
  }
  {
    const { db } = fakeDb(); const logs: string[] = [];
    const note = "read forward by start time and stopped after page 4 of 39 (reached events from before the window)";
    const deps = { db, hcp: fakeHcp([ev("evt_a", 1, 7, 8, [DRAY])], [], { count: 4, total: 3859, note }) };
    const { employees } = await syncEmployees(deps, { dryRun: false });
    const r = await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: true, employees, log: (m) => logs.push(m) });
    eq("E3 the report says how the read went, and how many pages HCP has versus how many were read", [r.notes, r.pages, r.totalPages, r.totalItems], [[note], 4, 4, 3859]);
    check("E3 the same note reaches the server window", logs.includes(`[events] ${note}`), logs.join(" | "));
  }
  {
    // the client now decides how far back to look; the sync just hands over the window
    const { db } = fakeDb(); let askedFrom: Date | null = null;
    const hcp = fakeHcp([]); hcp.listEvents = async (from: Date) => { askedFrom = from; return []; };
    await syncEventsWindow({ db, hcp }, { from: FROM, to: TO, dryRun: true, employees: [] });
    eq("E4 the sync passes the window start through unchanged (no extra look-back of its own)", askedFrom!.toISOString(), FROM.toISOString());
  }

  // ---------------- F. repeating events through the real sync ----------------
  {
    const { db, t } = fakeDb();
    const WEEKLY_MON = "FREQ=WEEKLY;INTERVAL=1;WKST=SU;BYDAY=MO";
    const series = ev("evt_series", 4, 8, 9, [DRAY, MATT], { name: "Weekly check-in", recurrence_rule: WEEKLY_MON });   // first occurrence: Mon Oct 12, 8:00 AM CDT
    const events: HcpEvent[] = [series];
    const deps = { db, hcp: fakeHcp(events) };
    const { employees } = await syncEmployees(deps, { dryRun: false });
    const dry = await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: true, employees, timeZone: "America/Chicago" });
    eq("F1 dry run: one series becomes 4 occurrences x 2 people", [dry.repeating.series, dry.repeating.occurrencesInWindow, dry.usable, dry.rows], [1, 4, 4, 8]);
    check("F1 the repeating details say when a normal read stops reaching it", dry.repeating.details.length === 1 && dry.repeating.details[0].unsupported === null && /^\d{4}-\d{2}-\d{2}$/.test(dry.repeating.details[0].visibleUntil), JSON.stringify(dry.repeating.details));
    check("F1 nothing written on a dry run", t.appts.length === 0);
    await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: false, employees, timeZone: "America/Chicago" });
    eq("F2 written: 8 rows, one per occurrence per person", t.appts.length, 8);
    eq("F2 the November occurrence is 14:00Z, because 8:00 AM stays 8:00 AM when the clocks change", t.appts.filter((r) => r.technicianId === t.technicians.find((x) => x.name === "Drayton Wilson")!.id).map((r) => r.startTime.toISOString()).sort(), ["2026-10-12T13:00:00.000Z", "2026-10-19T13:00:00.000Z", "2026-10-26T13:00:00.000Z", "2026-11-02T14:00:00.000Z"]);
    await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: false, employees, timeZone: "America/Chicago" });
    eq("F3 running again changes nothing", t.appts.length, 8);

    // the series is edited: now Tuesdays, starting Oct 13
    series.start_time = T(5, 8); series.end_time = T(5, 9); series.recurrence_rule = "FREQ=WEEKLY;INTERVAL=1;WKST=SU;BYDAY=TU";
    await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: false, employees, timeZone: "America/Chicago" });
    eq("F4 editing a series from Mondays to Tuesdays replaces the old rows (no ghost Mondays)", [t.appts.length, [...new Set(t.appts.map((r) => r.startTime.toISOString().slice(0, 10)))].sort()], [8, ["2026-10-13", "2026-10-20", "2026-10-27", "2026-11-03"]]);

    // one person is taken off the whole series
    series.assigned_employees = [{ id: DRAY }];
    await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: false, employees, timeZone: "America/Chicago" });
    eq("F5 taking a person off a series drops their row for EVERY occurrence", [t.appts.length, [...new Set(t.appts.map((r) => r.technicianId))].length], [4, 1]);

    // the series is deleted in HCP (some other event is still listed)
    events.length = 0; events.push(ev("evt_other", 9, 9, 10, [DRAY]));
    await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: false, employees, timeZone: "America/Chicago" });
    eq("F6 a series deleted in HCP disappears from every day", names(t), ["event:evt_other|Drayton Wilson|event"]);
  }
  {
    // a rule we cannot expand is reported, and the first occurrence still blocks
    const { db, t } = fakeDb();
    const deps = { db, hcp: fakeHcp([ev("evt_year", 4, 8, 9, [DRAY], { recurrence_rule: "FREQ=YEARLY;BYMONTH=10" })]) };
    const { employees } = await syncEmployees(deps, { dryRun: false });
    const r = await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: false, employees, timeZone: "America/Chicago" });
    eq("F7 an unsupported rule: first occurrence stored, and the report names the problem", [t.appts.length, r.repeating.details[0].unsupported !== null, r.repeating.occurrencesInWindow], [1, true, 1]);
  }
  {
    // the time zone option is really used when the event carries none
    const mk = async (timeZone: string) => {
      const { db, t } = fakeDb();
      const deps = { db, hcp: fakeHcp([ev("evt_s", 4, 8, 9, [DRAY], { recurrence_rule: "FREQ=WEEKLY;BYDAY=MO" })]) };
      const { employees } = await syncEmployees(deps, { dryRun: false });
      await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: false, employees, timeZone });
      return t.appts.map((r) => r.startTime.toISOString()).sort();
    };
    const chicago = await mk("America/Chicago"), utc = await mk("UTC");
    eq("F8 in Chicago the Nov 2 occurrence shifts an hour with daylight saving; in UTC it does not", [chicago[3], utc[3]], ["2026-11-02T14:00:00.000Z", "2026-11-02T13:00:00.000Z"]);
  }
  {
    // the report never grows without bound
    const { db } = fakeDb();
    const many = Array.from({ length: 14 }, (_, i) => ev(`evt_m${i}`, 4, 8, 9, [DRAY], { recurrence_rule: "FREQ=WEEKLY;BYDAY=MO" }));
    const deps = { db, hcp: fakeHcp(many) };
    const { employees } = await syncEmployees(deps, { dryRun: false });
    const r = await syncEventsWindow(deps, { from: FROM, to: TO, dryRun: true, employees, timeZone: "America/Chicago" });
    eq("F9 14 series are all counted but only 10 are listed in detail", [r.repeating.series, r.repeating.details.length], [14, 10]);
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(2); });
