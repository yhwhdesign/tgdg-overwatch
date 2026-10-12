import { diagnoseDay, type DiagnoseDeps, type StoredRow } from "../../src/lib/hcp-diagnose.ts";
import { jobToAppointmentRows, type HcpApi, type HcpEmployee, type HcpJob, type HcpAppointment, type JobsPage } from "../../src/lib/hcp-sync.ts";
import { calendarDayBounds, syncWindow } from "../../src/lib/availability.ts";

let passes = 0, failures = 0;
const check = (n: string, ok: boolean, d = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${n}${d ? "  <- " + d : ""}`); } };
const eq = (n: string, a: unknown, b: unknown) => check(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);

const DRAY: HcpEmployee = { id: "pro_dray", first_name: "Drayton", last_name: "Wilson", role: "field tech" };
const RICK: HcpEmployee = { id: "pro_rick", first_name: "Rick", last_name: "Blair", role: "admin" };
const MATT: HcpEmployee = { id: "pro_matt", first_name: "Matthew", last_name: "Tucker", role: "field tech" };
const EMPLOYEES = [DRAY, RICK, MATT];

const NOW = new Date("2026-10-06T15:00:00Z");                 // Tue Oct 6, 10:00 AM CDT
const L = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 9, 6 + day, h + 5, m)).toISOString();   // CDT wall clock; day 0 = Oct 6
const jobId = (n: string) => `job_${n.padStart(32, "0")}`;
const PII = { customer: { first_name: "Zelda", last_name: "Quimby", email: "zelda@example.com", mobile_number: "5015550142" }, address: { street: "742 Evergreen Terrace", zip: "72201" }, notes: "Gate code 4471", total_amount: 48750 };
const job = (n: string, startDay: number, sh: number, eh: number, assigned: string[], extra: Partial<HcpJob> = {}): HcpJob =>
  ({ id: jobId(n), work_status: "scheduled", canceled_at: null, deleted_at: null, schedule: { scheduled_start: L(startDay, sh), scheduled_end: L(startDay, eh) }, assigned_employees: assigned.map((id) => ({ id })), job_fields: { job_type: { id: "jt1", name: "Install" } }, ...PII, ...extra } as HcpJob);
const appt = (day: number, sh: number, eh: number, dispatched: string[], anytime = false): HcpAppointment =>
  ({ id: "appt_x", start_time: L(day, sh), end_time: L(day, eh), anytime, arrival_window_minutes: 120, dispatched_employees_ids: dispatched });

function world(jobs: HcpJob[], appts: Record<string, HcpAppointment[]>, stored: StoredRow[] | "notfound", opts: { total?: number; errors?: Record<string, Error> } = {}) {
  const calls = { appointmentLookups: 0, jobPages: 0 };
  const hcp: HcpApi = {
    async listEmployees() { return EMPLOYEES; },
    async *listJobsInWindow(from: Date, to: Date): AsyncGenerator<JobsPage> {
      calls.jobPages++;
      const matching = jobs.filter((j) => { const s = new Date(j.schedule!.scheduled_start!); return s >= from && s <= to; });   // HCP filters by the job's FIRST start
      yield { jobs: matching, page: 1, totalPages: 1, totalItems: opts.total ?? matching.length };
    },
    async getJob(id: string) { return jobs.find((j) => j.id === id) ?? null; },
    async listAppointments(id: string) { calls.appointmentLookups++; if (opts.errors?.[id]) throw opts.errors[id]; return appts[id] ?? []; },
  };
  const deps: DiagnoseDeps = {
    hcp, timeZone: "America/Chicago", dayBounds: calendarDayBounds, syncWindow: syncWindow(NOW), mapJob: jobToAppointmentRows,
    loadStored: async () => stored === "notfound" ? { technicianFound: false, rows: [], latestRowUpdate: null } : { technicianFound: true, rows: stored, latestRowUpdate: new Date("2026-10-06T14:30:00Z") },
  };
  return { deps, calls };
}
const dbRow = (n: string, day: number, sh: number, eh: number): StoredRow => ({ hcpJobId: jobId(n), startTime: new Date(L(day, sh)), endTime: new Date(L(day, eh)), status: "scheduled" });
const DATE = "2026-10-07";   // the day we're asking about: tomorrow (Wed)
const run = async (w: ReturnType<typeof world>, name = "Drayton Wilson", date = DATE) => diagnoseDay(w.deps, { name, date });
const ok = (r: Awaited<ReturnType<typeof run>>) => { if (!r.ok) throw new Error("expected ok report: " + r.error); return r; };

(async () => {
  // ---------- 1. everything healthy ----------
  {
    const j = job("a1", 1, 8, 12, ["pro_dray"]);
    const r = ok(await run(world([j], { [j.id]: [appt(1, 8, 12, ["pro_dray"])] }, [dbRow("a1", 1, 8, 12)])));
    check("1 healthy: one job found, our sync blocks it, it is in the database", r.items.length === 1 && r.items[0].ourSyncBlocksThisDay && r.items[0].inDatabase === true);
    check("1 healthy: says the data agrees (so any remaining problem is how it is drawn)", r.findings.length === 1 && /agree/.test(r.findings[0]), r.findings.join(" | "));
    eq("1 healthy: job-level schedule shown in business time", r.items[0].jobSchedule, { start: "Wed, Oct 7, 8:00 AM", end: "Wed, Oct 7, 12:00 PM" });
    eq("1 healthy: job type label read from an object", r.items[0].jobType, "Install");
    eq("1 healthy: ids are shortened to the last 6 characters", r.items[0].job, "0000a1");
    eq("1 healthy: staff names, not ids, for assigned and dispatched", [r.items[0].assignedNames, r.items[0].appointments[0].dispatchedNames], [["Drayton Wilson"], ["Drayton Wilson"]]);
  }

  // ---------- 2. STALE: HCP has it, our code would record it, our database does not ----------
  {
    const j = job("b1", 1, 8, 12, ["pro_dray"]);
    const r = ok(await run(world([j], { [j.id]: [appt(1, 8, 12, ["pro_dray"])] }, [])));
    check("2 stale: sync logic is fine but the row is missing", r.items[0].ourSyncBlocksThisDay && r.items[0].inDatabase === false);
    check("2 stale: finding says STALE and to re-run the sync", r.findings.some((f) => /STALE/.test(f) && /re-run the sync/.test(f)), r.findings.join(" | "));
  }

  // ---------- 3. MULTI-DAY INSTALL that began before our sync window ----------
  {
    // first visit Mon Oct 5 (before the sync window starts Oct 6); today's visit AND tomorrow's are extra appointments
    const j = job("c1", -1, 8, 12, ["pro_dray"]);
    const r = ok(await run(world([j], { [j.id]: [appt(-1, 8, 12, ["pro_dray"]), appt(0, 8, 17, ["pro_dray"]), appt(1, 8, 17, ["pro_dray"])] }, [])));
    const it = r.items[0];
    check("3 multi-day: found even though the job began two days ago", r.items.length === 1);
    check("3 multi-day: our sync does NOT block tomorrow", it.ourSyncBlocksThisDay === false);
    check("3 multi-day: explains the job's FIRST start is outside our window", it.notes.some((n) => /never asks/.test(n) && /FIRST start/.test(n) && /Mon, Oct 5/.test(n)), it.notes.join(" | "));
    check("3 multi-day: explains tomorrow is a separate appointment, not the job-level schedule", it.notes.some((n) => /separate appointment/.test(n) && /Wed, Oct 7, 8:00 AM to 5:00 PM/.test(n) && /Mon, Oct 5, 8:00 AM to 12:00 PM/.test(n)), it.notes.join(" | "));
    check("3 multi-day: only the appointment on that day is flagged 'this day'", it.appointments.map((a) => a.onThisDay).join() === "false,false,true", it.appointments.map((a) => a.onThisDay).join());
    check("3 multi-day: the findings carry both reasons", r.findings.filter((f) => /\.\.\.0000c1/.test(f)).length >= 2, r.findings.join(" | "));
  }

  // ---------- 4. job inside our window, but tomorrow is an extra appointment ----------
  {
    const j = job("d1", 0, 8, 12, ["pro_dray"]);            // job-level schedule = TODAY only
    const r = ok(await run(world([j], { [j.id]: [appt(0, 8, 12, ["pro_dray"]), appt(1, 8, 12, ["pro_dray"])] }, [dbRow("d1", 0, 8, 12)])));
    const it = r.items[0];
    check("4 extra-appointment: job IS fetched by our window, yet tomorrow is not blocked", it.ourSyncBlocksThisDay === false && !it.notes.some((n) => /never asks/.test(n)), it.notes.join(" | "));
    check("4 extra-appointment: names the separate appointment and the job-level schedule we actually read", it.notes.some((n) => /separate appointment/.test(n) && /Tue, Oct 6, 8:00 AM to 12:00 PM/.test(n)), it.notes.join(" | "));
  }

  // ---------- 5. dispatched on the appointment but not in the job's assigned list ----------
  {
    const j = job("e1", 1, 8, 12, ["pro_rick"]);            // job assigned to someone else
    const r = ok(await run(world([j], { [j.id]: [appt(1, 8, 12, ["pro_dray"])] }, [])));
    check("5 dispatched-not-assigned: found via the appointment", r.items.length === 1 && r.items[0].appointments[0].includesPerson);
    check("5 dispatched-not-assigned: explains we only use the assigned list, and names who is assigned", r.items[0].notes.some((n) => /dispatched on that appointment but is not in the job's assigned list/.test(n) && /Rick Blair/.test(n)), r.items[0].notes.join(" | "));
    check("5 ...and our sync indeed does not block him", r.items[0].ourSyncBlocksThisDay === false);
  }

  // ---------- 6. canceled / unscheduled ----------
  {
    const j = job("f1", 1, 8, 12, ["pro_dray"], { canceled_at: "2026-10-05T00:00:00Z" });
    const r = ok(await run(world([j], { [j.id]: [appt(1, 8, 12, ["pro_dray"])] }, [])));
    check("6 canceled: our sync skips it, and the note says why", !r.items[0].ourSyncBlocksThisDay && r.items[0].notes.some((n) => /skips this job \(canceled\)/.test(n)), r.items[0].notes.join(" | "));
  }

  // ---------- 7. nothing in HCP at all: maybe an estimate or a calendar event ----------
  {
    const other = job("g1", 1, 8, 12, ["pro_matt"]);       // someone else's job that day
    const r = ok(await run(world([other], { [other.id]: [appt(1, 8, 12, ["pro_matt"])] }, [])));
    check("7 nothing: no items, and someone else's job is NOT listed", r.items.length === 0);
    check("7 nothing: suggests an Estimate or calendar Event rather than a job", r.findings.some((f) => /NO job or appointment/.test(f) && /Estimate/.test(f) && /Event/.test(f)), r.findings.join(" | "));
  }

  // ---------- 8. names ----------
  {
    const w = world([], {}, []);
    const none = await run(w, "Nobody Here");
    check("8 unknown name: clear error listing the real people", !none.ok && /No Housecall Pro employee matches/.test(none.error) && /Drayton Wilson/.test(none.error), JSON.stringify(none));
    const partial = await run(w, "dray");
    check("8 a partial, any-case name works", partial.ok && partial.person.name === "Drayton Wilson");
    const amb = await run(world([], {}, []), "r");   // matches Drayton? "r" appears in many names
    check("8 an ambiguous name is refused with the candidates", !amb.ok && /More than one person/.test(amb.error), JSON.stringify(amb));
    const blank = await run(w, "   ");
    check("8 blank name is refused", !blank.ok);
  }

  // ---------- 9. our database holds something HCP no longer shows ----------
  {
    const j = job("h1", 1, 8, 12, ["pro_dray"]);
    const r = ok(await run(world([j], { [j.id]: [appt(1, 8, 12, ["pro_dray"])] }, [dbRow("h1", 1, 8, 12), dbRow("zz9", 1, 13, 15)])));
    check("9 extra database row: reported as something HCP no longer shows", r.findings.some((f) => /\.\.\.000zz9/.test(f) && /no longer shows/.test(f)), r.findings.join(" | "));
    eq("9 database section lists both rows", r.database.rows.map((x) => x.job), ["0000h1", "000zz9"]);
  }

  // ---------- 10. not in our database ----------
  {
    const j = job("i1", 1, 8, 12, ["pro_dray"]);
    const r = ok(await run(world([j], { [j.id]: [appt(1, 8, 12, ["pro_dray"])] }, "notfound")));
    check("10 person not in our database: says to run the sync first", r.findings.some((f) => /not in our database at all/.test(f)) && r.person.inDatabase === false && r.items[0].inDatabase === null);
  }

  // ---------- 11. safety ----------
  {
    let msg = "";
    try { await run(world([], {}, [], { total: 40146 })); } catch (e) { msg = (e as Error).message; }
    check("11 an ignored date filter aborts instead of paging through everything", /date filter was probably ignored/.test(msg), msg);
    const many = Array.from({ length: 12 }, (_, i) => job(`m${i}`, 1, 8, 9, ["pro_dray"]));
    const w = world(many, {}, []);
    w.deps.maxAppointmentLookups = 5;
    await run(w);
    eq("11 appointment lookups are capped (never an unbounded storm of requests)", w.calls.appointmentLookups, 5);
  }

  // ---------- 12. 'anytime' ----------
  {
    const j = job("j1", 1, 0, 23, ["pro_dray"]);
    const r = ok(await run(world([j], { [j.id]: [appt(1, 0, 23, ["pro_dray"], true)] }, [])));
    check("12 an 'anytime' appointment is called out", r.items[0].notes.some((n) => /anytime/.test(n)) && r.items[0].appointments[0].anytime);
  }

  // ---------- 13. privacy: no customer data in the report ----------
  {
    const j = job("k1", 1, 8, 12, ["pro_dray"]);
    const r = await run(world([j], { [j.id]: [appt(1, 8, 12, ["pro_dray"])] }, [dbRow("k1", 1, 8, 12)]));
    const text = JSON.stringify(r);
    for (const needle of ["Zelda", "Quimby", "Evergreen", "4471", "example.com", "5015550", "48750", "72201", jobId("k1")]) {
      check(`13 privacy: '${needle}' is not in the report`, !text.includes(needle));
    }
  }

  // ---------- 14. day bounds ----------
  {
    const a = calendarDayBounds("2026-10-07");
    eq("14 a normal day is midnight to midnight CDT (24 h)", [a.start.toISOString(), (a.end.getTime() - a.start.getTime()) / 3600000], ["2026-10-07T05:00:00.000Z", 24]);
    const fall = calendarDayBounds("2026-11-01");
    eq("14 the clocks-fall-back day is 25 hours long", (fall.end.getTime() - fall.start.getTime()) / 3600000, 25);
    const spring = calendarDayBounds("2027-03-14");
    eq("14 the spring-forward day is 23 hours long", (spring.end.getTime() - spring.start.getTime()) / 3600000, 23);
    let e1 = "", e2 = "";
    try { calendarDayBounds("10/07/2026"); } catch (e) { e1 = (e as Error).message; }
    try { calendarDayBounds("2026-02-31"); } catch (e) { e2 = (e as Error).message; }
    check("14 bad dates are refused", /YYYY-MM-DD/.test(e1) && /real calendar date/.test(e2));
  }

  // ---------- 15. ARCHIVED jobs: the report must survive them, and say the right thing ----------
  const archivedErr = () => Object.assign(new Error('HCP API error 400 on /jobs/{id}/appointments: {"error":{"message":"Archived job"}}'), { archived: true, status: 400 });
  {
    // the situation reported: asking about a day that has already passed (yesterday, relative to NOW = Tue Oct 6)
    const j = job("n1", -1, 8, 12, ["pro_dray"], { work_status: "complete rated" });
    const r = ok(await run(world([j], {}, [], { errors: { [j.id]: archivedErr() } }), "Drayton Wilson", "2026-10-05"));
    check("15 archived job on a PAST day: the report completes instead of crashing", r.items.length === 1);
    check("15 ...it is flagged archived and counted", r.items[0].archived === true && r.scanned.archivedJobs === 1, JSON.stringify(r.scanned));
    check("15 ...and the note says it's finished and no longer matters, NOT a false booking", r.items[0].notes.some((n) => /ARCHIVED/.test(n) && /already passed/.test(n)) && !r.items[0].notes.some((n) => /FALSE booking/.test(n)), r.items[0].notes.join(" | "));
  }
  {
    // an archived job sitting on a FUTURE day that our sync still records is a genuine false booking
    const j = job("n2", 1, 8, 12, ["pro_dray"]);
    const r = ok(await run(world([j], {}, [dbRow("n2", 1, 8, 12)], { errors: { [j.id]: archivedErr() } })));
    check("15 archived job on a FUTURE day: called out as a FALSE booking", r.items[0].archived && r.items[0].notes.some((n) => /FALSE booking/.test(n)), r.items[0].notes.join(" | "));
    check("15 ...and it's listed in the findings", r.findings.some((f) => /ARCHIVED/.test(f)), r.findings.join(" | "));
  }
  {
    // some other failure (HCP hiccup) is reported, not fatal
    const j = job("n3", 1, 8, 12, ["pro_dray"]);
    const r = ok(await run(world([j], {}, [dbRow("n3", 1, 8, 12)], { errors: { [j.id]: new Error("HCP API error 500 on /jobs/{id}/appointments: boom") } })));
    check("15 a non-archive failure is recorded on the item, and the report still completes", r.items[0].archived === false && /500/.test(r.items[0].lookupError ?? "") && r.scanned.lookupErrors === 1 && r.scanned.archivedJobs === 0, JSON.stringify([r.items[0].lookupError, r.scanned]));
    check("15 ...with its own note", r.items[0].notes.some((n) => /Could not read this job's appointments/.test(n)));
  }
  {
    // every lookup fails: still a report
    const jobs = [job("p1", 1, 8, 9, ["pro_dray"]), job("p2", 1, 10, 11, ["pro_dray"])];
    const r = ok(await run(world(jobs, {}, [], { errors: Object.fromEntries(jobs.map((j) => [j.id, archivedErr()])) })));
    check("15 even when EVERY appointment lookup fails, the report completes", r.items.length === 2 && r.scanned.archivedJobs === 2);
  }

  // ---------- 16. the look-back skips finished jobs (they can't have a visit still to come) ----------
  {
    const finished = [job("q1", -10, 8, 12, ["pro_dray"], { work_status: "complete rated" }), job("q2", -12, 8, 12, ["pro_dray"], { work_status: "complete unrated" }), job("q3", -9, 8, 12, ["pro_dray"], { canceled_at: "2026-09-30T00:00:00Z", work_status: "user canceled" })];
    const underway = job("q4", -5, 8, 12, ["pro_dray"], { work_status: "in progress" });   // a multi-day install still under way
    const w = world([...finished, underway], { [underway.id]: [appt(-5, 8, 12, ["pro_dray"]), appt(1, 8, 17, ["pro_dray"])] }, []);
    const r = ok(await run(w));
    eq("16 only the unfinished older job is looked up (3 finished ones are skipped)", w.calls.appointmentLookups, 1);
    check("16 ...and that under-way install is still found, via its visit on the day", r.items.length === 1 && r.items[0].job === "0000q4" && r.items[0].appointments.some((a) => a.onThisDay));
  }
  {
    // a finished job that is ON the day in question is still read (so the report can describe it)
    const j = job("r1", 1, 8, 12, ["pro_dray"], { work_status: "complete rated" });
    const w = world([j], { [j.id]: [appt(1, 8, 12, ["pro_dray"])] }, []);
    ok(await run(w));
    eq("16 a finished job on the day itself is still looked up", w.calls.appointmentLookups, 1);
  }

  // ---------- 17. does the job list itself reveal archiving? ----------
  {
    const j = job("s1", 1, 8, 12, ["pro_dray"], { archived_at: "2026-10-07T20:00:00Z", archive_reason: "done" } as Partial<HcpJob>);
    const r = ok(await run(world([j], { [j.id]: [appt(1, 8, 12, ["pro_dray"])] }, [])));
    check("17 any field mentioning 'archive' on the job list entry is surfaced", r.items[0].archiveFields.archived_at === "2026-10-07T20:00:00Z" && r.items[0].archiveFields.archive_reason === "done", JSON.stringify(r.items[0].archiveFields));
    const plain = ok(await run(world([job("s2", 1, 8, 12, ["pro_dray"])], {}, [])));
    check("17 a job with no such field reports none", Object.keys(plain.items[0].archiveFields).length === 0);
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(2); });
