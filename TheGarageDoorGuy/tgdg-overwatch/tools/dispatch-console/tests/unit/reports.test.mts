// Reports engine against hand-built jobs (no network). Every expected number below is worked out by hand.
import { buildReport, findGoBacks, lineItems, rangeFor, rankAll, MIN_JOBS, type RJob, type REstimate } from "../../src/lib/reports.ts";

let passes = 0, failures = 0;
const eq = (name: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (ok) passes++; else { failures++; console.log(`FAIL ${name}  <- got ${JSON.stringify(got)} expected ${JSON.stringify(want)}`); } };
const check = (name: string, ok: boolean, detail = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${name} ${detail}`); } };

const TZ = "America/Chicago";
// CDT wall clock -> ISO (Oct 2026 is UTC-5)
const at = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 9, day, h + 5, m)).toISOString();
let n = 0;
const W = [34.7465, -92.35], E = [34.7465, -92.262]; // ~5 miles apart
function job(o: { techs: string[]; day: number; sh: number; omw?: number | null; start?: number | null; end?: number | null; total?: number; owed?: number; customer?: string; kind?: string; items?: { name: string; unit_price: number; quantity?: number }[]; pt?: number[] | null; tags?: string[]; status?: string; zip?: string; bu?: string }): RJob {
  n++;
  const s = o.start === undefined ? o.sh : o.start;
  return {
    id: `job_${n}`, invoice_number: 1000 + n, work_status: o.status ?? "complete rated",
    total_amount: o.total ?? 20000, outstanding_balance: o.owed ?? 0,
    schedule: { scheduled_start: at(o.day, o.sh), scheduled_end: at(o.day, o.sh + 1) },
    work_timestamps: {
      on_my_way_at: o.omw === null ? null : at(o.day, o.sh, -20 + (o.omw ?? 0)),
      started_at: s === null ? null : at(o.day, s),
      completed_at: o.end === null ? null : at(o.day, o.end ?? (s ?? o.sh) + 1),
    },
    assigned_employees: o.techs.map((id) => ({ id })),
    customer: { id: o.customer ?? `cus_${n}` },
    address: { zip: o.zip ?? "72201", latitude: o.pt === null ? null : (o.pt ?? W)[0], longitude: o.pt === null ? null : (o.pt ?? W)[1] },
    job_fields: { job_type: { name: o.kind === "install" ? "Install" : "Repair" }, business_unit: { name: o.bu ?? "Residential" } },
    tags: o.tags ?? [],
    line_items: o.items ?? [{ name: "Service call", unit_price: 8900 }],
  };
}
const classify = (j: RJob) => (/install/i.test(JSON.stringify(j.job_fields)) ? "install" : "service") as "install" | "service";
const names = new Map([["A", "Alex Tech"], ["B", "Blake Tech"], ["C", "Casey Tech"], ["D", "Dana Tech"]]);
const range = { from: "2026-10-01", to: "2026-10-31", label: "Oct", previousLabel: null };
const run = (jobs: RJob[], estimates: REstimate[] = [], previousJobs: RJob[] | null = null) => buildReport({ jobs, previousJobs, estimates, previousEstimates: previousJobs ? [] : null, names, classify, range, timeZone: TZ });

// ---------- 1. money, split, tickets ----------
{
  const jobs = [
    job({ techs: ["A"], day: 5, sh: 9, total: 30000 }),
    job({ techs: ["A", "B"], day: 5, sh: 13, end: 17, total: 100000, kind: "install" }), // split 50/50, 4h on job
    job({ techs: ["B"], day: 6, sh: 9, total: 0 }),                                       // a $0 job: counts as a job, not in avg ticket
    job({ techs: ["B"], day: 6, sh: 11, status: "scheduled" }),                           // not finished: ignored
    job({ techs: ["A"], day: 7, sh: 9, status: "user canceled" }),                        // canceled: ignored
  ];
  const r = run(jobs);
  eq("M1 company revenue, jobs, avg ticket (paid jobs only)", [r.tiles.revenueCents, r.tiles.jobs, r.tiles.avgTicketCents], [130000, 3, 65000]);
  const A = r.techs.find((t) => t.id === "A")!, B = r.techs.find((t) => t.id === "B")!;
  eq("M2 two-tech job splits the money, both get the job", [A.revenueCents, A.jobs, B.revenueCents, B.jobs], [80000, 2, 50000, 2]);
  eq("M3 tech avg ticket = his money / his paid jobs", [A.avgTicketCents, B.avgTicketCents], [40000, 50000]);
  eq("M4 tech-days and money per day", [A.techDays, A.revenuePerDayCents, B.techDays, B.revenuePerDayCents], [1, 80000, 2, 25000]);
  eq("M5 time on job and money per on-job hour (A: 1h + 4h = 5h)", [A.onJobHours, A.revenuePerHourCents], [5, 16000]);
  eq("M6 revenue per tech-day (company)", r.tiles.revenuePerTechDayCents, Math.round(130000 / 3));
  eq("M7 install vs service counts", [A.installs, A.service], [1, 1]);
  eq("M8 mix by kind", r.mix.byKind.map((g) => [g.key, g.jobs, g.revenueCents]), [["Installs", 1, 100000], ["Service / repair", 2, 30000]]);
}

// ---------- 2. drive, miles, on time, utilization ----------
{
  n = 0;
  const jobs = [
    job({ techs: ["A"], day: 5, sh: 8, omw: 0, pt: W }),                 // on my way 7:40, start 8:00 -> 20 min drive
    job({ techs: ["A"], day: 5, sh: 10, omw: 10, start: 10, pt: E }),    // on my way 9:50 -> 10 min; ~5 mi from W
    job({ techs: ["A"], day: 5, sh: 13, omw: 0, start: 14, pt: W }),     // scheduled 1:00, started 2:00 = 60 min late; omw 12:40 -> 80 min drive
    job({ techs: ["A"], day: 6, sh: 9, omw: null, pt: null }),           // no omw tap, no point
  ];
  const r = run(jobs);
  const A = r.techs[0];
  eq("D1 drive minutes add up only where both taps exist (20+10+80)", [A.driveMinutes, A.drivePerJobMinutes], [110, 36.7]);
  check("D2 miles: W->E->W, about 5 mi each way x1.3", A.miles !== null && A.miles >= 12 && A.miles <= 14, String(A.miles));
  eq("D3 on time: 3 of 4 (one started an hour late)", [A.onTimePct, A.lateStarts, r.lateStarts[0].minutesLate], [75, 1, 60]);
  // day 5 span: 7:40 -> 15:00 = 440 min; busy 3h = 180 -> 40.9%; day 6: span 9:00-10:00 = 60, busy 60.  total 240/500 = 48%
  eq("D4 utilization = on-job time / first tap to last finish", A.utilizationPct, 48);
}

// ---------- 3. go-backs ----------
{
  n = 0;
  const first = job({ techs: ["A"], day: 3, sh: 9, customer: "cus_x" });
  const back = job({ techs: ["B"], day: 10, sh: 9, customer: "cus_x", total: 0 });              // free return 7 days later
  const paidNext = job({ techs: ["B"], day: 12, sh: 9, customer: "cus_y" });
  const paidNextSame = job({ techs: ["B"], day: 20, sh: 9, customer: "cus_x", total: 45000 }); // a normal paid visit: not a go-back
  const tagged = job({ techs: ["C"], day: 25, sh: 9, customer: "cus_y", total: 9900, tags: ["Warranty"] }); // paid but tagged warranty, 13 days later
  const late = job({ techs: ["C"], day: 28, sh: 9, customer: "cus_z", total: 0 });              // free, but no earlier visit
  const pairs = findGoBacks([first, back, paidNext, paidNextSame, tagged, late]);
  eq("G1 free return and a tagged warranty visit count; a paid normal visit doesn't", pairs.map((p) => [p.back.id, p.first.id, p.days]), [["job_2", "job_1", 7], ["job_5", "job_3", 13]]);
  const r = run([first, back, paidNext, paidNextSame, tagged, late]);
  eq("G2 charged to the tech on the FIRST visit", [r.techs.find((t) => t.id === "A")!.goBacks, r.techs.find((t) => t.id === "B")!.goBacks], [1, 1]);
  eq("G3 the list names both job numbers", [r.goBacks.map((g) => [g.number, g.firstNumber])], [[["1005", "1003"], ["1002", "1001"]]]);
  const old = job({ techs: ["A"], day: 1, sh: 9, customer: "cus_q" });
  const tooLate = { ...job({ techs: ["A"], day: 1, sh: 9, customer: "cus_q", total: 0 }), schedule: { scheduled_start: new Date(Date.UTC(2026, 10, 15, 14)).toISOString() } };
  eq("G4 more than 30 days later is not a go-back", findGoBacks([old, tooLate]).length, 0);
}

// ---------- 4. selling beyond the call, products ----------
{
  n = 0;
  const call = { name: "Service call", unit_price: 8900 };
  const jobs = [
    job({ techs: ["A"], day: 5, sh: 9, items: [call, { name: "Torsion Spring 207", unit_price: 15000, quantity: 2 }, { name: "Rollers", unit_price: 4000 }] }),
    job({ techs: ["A"], day: 5, sh: 11, items: [call, { name: "torsion  spring 207", unit_price: 15000 }] }),
    job({ techs: ["B"], day: 5, sh: 9, items: [call] }),
    job({ techs: ["B"], day: 5, sh: 11, items: [call, { name: "Free inspection", unit_price: 0 }] }), // $0 item isn't billable
  ];
  const r = run(jobs);
  const A = r.techs.find((t) => t.id === "A")!, B = r.techs.find((t) => t.id === "B")!;
  eq("S1 items per job and add-on rate", [A.itemsPerJob, A.addOnRatePct, B.itemsPerJob, B.addOnRatePct], [2.5, 100, 1, 0]);
  eq("S2 products grouped by name (case/spaces ignored), by revenue", r.products.map((p) => [p.name, p.jobs, p.quantity, p.revenueCents]), [["Service call", 4, 4, 35600], ["Torsion Spring 207", 2, 3, 45000], ["Rollers", 1, 1, 4000]].sort((a, b) => (b[3] as number) - (a[3] as number)));
  const springCol = r.productMatrix.products.indexOf("Torsion Spring 207");
  eq("S3 tech x product matrix", r.productMatrix.rows.map((row) => [row.tech, row.counts[springCol]]), [["Alex Tech", 2], ["Blake Tech", 0]]);
  eq("S4 line items read defensively", [lineItems({ id: "x", line_items: "junk" }).length, lineItems({ id: "x", line_items: [null, { name: "" }, { name: "Opener", amount: 45000 }] })], [0, [{ name: "Opener", quantity: 1, amountCents: 45000 }]]);
}

// ---------- 5. estimates ----------
{
  const est = (id: string, emp: string, opts: [number, string][], ws = "complete"): REstimate => ({ id, work_status: ws, created_at: at(10, 9), assigned_employees: [{ id: emp }], options: opts.map(([t, s]) => ({ total_amount: t, approval_status: s })) });
  const estimates = [
    est("e1", "A", [[100000, "approved"], [150000, "declined"]]),
    est("e2", "A", [[200000, "expired"]]),
    est("e3", "A", [[50000, ""]], "created job from estimate"),
    est("e4", "B", [[90000, "pro approved"]]),
    est("e5", "B", [[90000, "approved"]], "canceled"),       // canceled: not presented
    est("e6", "D", [[70000, "declined"]]),                   // D has estimates but no jobs: still a row
  ];
  const r = run([job({ techs: ["A"], day: 5, sh: 9 })], estimates);
  const A = r.techs.find((t) => t.id === "A")!, D = r.techs.find((t) => t.id === "D")!;
  eq("E1 close rate: approved option or job created", [A.estimates, A.estimatesWon, A.closeRatePct], [3, 2, 66.7]);
  eq("E2 won $ = approved options (or the option when a job was made); presented $ = highest option", [A.estimateWonCents, A.estimatePresentedCents, A.avgOptions], [150000, 400000, 1.3]);
  eq("E3 an estimator with no jobs still shows", [D.name, D.estimates, D.closeRatePct, D.jobs], ["Dana Tech", 1, 0, 0]);
  eq("E4 company close rate (canceled left out)", r.tiles.closeRatePct, 60);
}

// ---------- 6. ranks, small samples, after hours, trend, comparison ----------
{
  n = 0;
  const many = (tech: string, count: number, total: number) => Array.from({ length: count }, (_, i) => job({ techs: [tech], day: 1 + (i % 25), sh: 9 + (i % 3) * 2, total }));
  const jobs = [...many("A", 12, 50000), ...many("B", 12, 30000), ...many("C", 12, 20000), ...many("D", 4, 90000)];
  const r = run(jobs);
  const by = (id: string) => r.techs.find((t) => t.id === id)!;
  eq("R1 fewer than MIN_JOBS = small sample, not ranked", [MIN_JOBS, by("D").smallSample, by("D").ranks.avgTicketCents ?? null], [10, true, null]);
  eq("R2 ranks among the rest: top / mid / bottom", [by("A").ranks.avgTicketCents, by("B").ranks.avgTicketCents, by("C").ranks.avgTicketCents], ["top", "mid", "bottom"]);
  eq("R3 small samples are listed last", r.techs.map((t) => t.id), ["A", "B", "C", "D"]);
  eq("R4 median among ranked techs", r.medians.avgTicketCents, 30000);

  n = 0;
  const sat = job({ techs: ["A"], day: 3, sh: 10, total: 50000 }); // Oct 3 2026 is a Saturday
  const eve = job({ techs: ["A"], day: 5, sh: 18, total: 30000 }); // Monday 6 PM
  const day = job({ techs: ["A"], day: 5, sh: 9, total: 20000 });
  const r2 = run([sat, eve, day], [], [day]);
  eq("R5 after-hours share and its average ticket", [r2.tiles.afterHoursPct, r2.mix.afterHours.jobs, r2.mix.afterHours.avgTicketCents], [66.7, 2, 40000]);
  eq("R6 previous period tiles come back for the comparison", [r2.previous?.revenueCents, r2.previous?.jobs], [20000, 1]);
  eq("R7 weekly trend for a month-long range (Monday weeks)", r2.trend.map((t) => [t.key, t.revenueCents]), [["2026-09-28", 50000], ["2026-10-05", 50000]]);
  eq("R8 notes warn when data is thin", run([job({ techs: ["A"], day: 5, sh: 9, pt: null, start: null })]).dataNotes.length >= 2, true);
}

// lower is better for drive, miles and go-backs: the LEAST driving is the top rank
{
  const row = (id: string, drive: number, goBack: number) => ({ id, smallSample: false, drivePerJobMinutes: drive, goBackRatePct: goBack, ranks: {} } as unknown as Parameters<typeof rankAll>[0][number]);
  const rows = [row("a", 10, 1), row("b", 20, 4), row("c", 40, 9)];
  rankAll(rows);
  eq("R9 least driving and fewest go-backs rank top; most rank bottom", rows.map((r) => [r.ranks.drivePerJobMinutes, r.ranks.goBackRatePct]), [["top", "top"], ["mid", "mid"], ["bottom", "bottom"]]);
}

// ---------- 7. ranges ----------
eq("Q1 last 30 days + the 30 before", (({ from, to, previous }) => [from, to, previous?.from, previous?.to])(rangeFor("30", "2026-11-01")), ["2026-10-03", "2026-11-01", "2026-09-03", "2026-10-02"]);
eq("Q2 year to date has no comparison", (({ from, previous }) => [from, previous])(rangeFor("ytd", "2026-11-01")), ["2026-01-01", null]);
eq("Q3 last month (and the month before)", (({ from, to, label, previous }) => [from, to, label, previous?.from, previous?.to])(rangeFor("last-month", "2026-03-15")), ["2026-02-01", "2026-02-28", "February 2026", "2026-01-01", "2026-01-31"]);

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
