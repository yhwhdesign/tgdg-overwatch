// Reports: the engine. Pure functions over Housecall Pro jobs and estimates (no network, no database), plus a small
// cached reader. READ-ONLY: nothing here ever writes to Housecall Pro.
//
// What each number means (decided from industry practice for home-service companies; see project_state.md):
//  - A job "counts" when it is complete (work_status contains "complete") and was scheduled inside the range.
//  - Money is HCP's total_amount in cents. A job with several techs splits its money evenly between them, but each of
//    them gets credit for the job itself (jobs, time, drive).
//  - Time on job = Finish tap - Start tap. Drive = Start tap - On my way tap (only between 1 and 180 minutes).
//  - Miles = straight-line distance between a tech's jobs in the order he started them that day, x1.3 for roads.
//    An estimate, not odometer miles.
//  - On time = he tapped Start no later than 15 minutes after the scheduled start.
//  - Go-back = a later job for the same customer within 30 days that was free ($0) or is tagged / typed as a
//    callback, warranty, go back or recall. It counts against the techs on the FIRST job.
//  - "Sells beyond the call": items per job (billable line items) and add-on rate (share of service calls with 2+
//    billable items). HCP doesn't keep what was on the ticket at booking, so this is the closest honest measure.
//  - Estimates: an estimate is won when an option is approved / pro approved, or a job was created from it.
//  - Ranks: each tech's number is compared with the other techs who have at least MIN_JOBS jobs: top quarter,
//    middle, bottom quarter. Fewer jobs than that = "small sample", not ranked.

export const MIN_JOBS = 10;
const ROAD_MILES_FACTOR = 1.3;
const ON_TIME_GRACE_MIN = 15;
const GO_BACK_DAYS = 30;
const MAX_JOB_MINUTES = 16 * 60;
const MAX_DRIVE_MINUTES = 180;
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

// ---- the shapes we read (all optional: HCP data is read defensively) ------------------------------------------

export interface RJob {
  id: string;
  invoice_number?: string | number | null;
  work_status?: string | null;
  total_amount?: number | null;
  outstanding_balance?: number | null;
  schedule?: { scheduled_start?: string | null; scheduled_end?: string | null } | null;
  work_timestamps?: { on_my_way_at?: string | null; started_at?: string | null; completed_at?: string | null } | null;
  assigned_employees?: { id: string }[] | null;
  customer?: { id?: string | null } | null;
  address?: { zip?: string | null; street?: string | null; latitude?: string | number | null; longitude?: string | number | null } | null;
  job_fields?: { job_type?: unknown; business_unit?: unknown } | null;
  tags?: unknown;
  line_items?: unknown;
  canceled_at?: string | null;
  deleted_at?: string | null;
}

export interface REstimate {
  id: string;
  work_status?: string | null;
  created_at?: string | null;
  assigned_employees?: { id?: string }[] | null;
  options?: { total_amount?: number | null; approval_status?: string | null; status?: string | null }[] | null;
}

export interface ReportInput {
  jobs: RJob[];
  /** Jobs from the period just before, for the comparison on the tiles (or null). */
  previousJobs: RJob[] | null;
  estimates: REstimate[];
  previousEstimates: REstimate[] | null;
  names: Map<string, string>;
  /** "install" or "service", the same rule Job Watch uses. */
  classify: (job: RJob) => "install" | "service";
  range: { from: string; to: string; label: string; previousLabel: string | null };
  timeZone: string;
  /** Business hours for the after-hours share (default Mon-Fri 8:00-17:00). */
  openHour?: number;
  closeHour?: number;
}

// ---- small helpers ----------------------------------------------------------------------------------------------

const ms = (v: string | null | undefined) => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};
const cents = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);
export const isComplete = (j: { work_status?: string | null }) => /complete/i.test(j.work_status ?? "");
const isCanceled = (j: RJob) => !!j.canceled_at || !!j.deleted_at || /cancel/i.test(j.work_status ?? "");

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (num: number, den: number) => (den > 0 ? round1((num / den) * 100) : null);

function wallParts(at: number, timeZone: string) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short" }).formatToParts(new Date(at));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, month: `${get("year")}-${get("month")}`, hour: Number(get("hour")), weekday: get("weekday") };
}

function textOf(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(textOf);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return [o.name, o.label, o.title].filter((x): x is string => typeof x === "string");
  }
  return [];
}
const nameOf = (v: unknown) => textOf(v)[0]?.trim() || null;

function point(j: RJob): [number, number] | null {
  const lat = Number(j.address?.latitude);
  const lng = Number(j.address?.longitude);
  if (j.address?.latitude == null || j.address?.longitude == null || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return [lat, lng];
}
function miles(a: [number, number], b: [number, number]) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface Item {
  name: string;
  quantity: number;
  amountCents: number;
}
/** Billable line items: a name and an amount (quantity x unit price, or the item's own total). */
export function lineItems(j: RJob): Item[] {
  if (!Array.isArray(j.line_items)) return [];
  const out: Item[] = [];
  for (const raw of j.line_items) {
    if (!raw || typeof raw !== "object") continue;
    const li = raw as Record<string, unknown>;
    const name = (typeof li.name === "string" ? li.name : "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    const qty = Number(li.quantity);
    const quantity = Number.isFinite(qty) && qty > 0 ? qty : 1;
    const unit = Number(li.unit_price);
    const total = Number(li.amount ?? li.total_amount ?? li.total);
    const amountCents = Number.isFinite(total) && total !== 0 ? Math.round(total) : Number.isFinite(unit) ? Math.round(unit * quantity) : 0;
    out.push({ name: name.slice(0, 80), quantity, amountCents });
  }
  return out;
}
const productKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const GO_BACK_WORDS = /call ?back|warranty|go ?back|recall|re-?visit|return trip/i;
function looksLikeGoBack(j: RJob): boolean {
  if (cents(j.total_amount) === 0) return true;
  return [...textOf(j.tags), ...textOf(j.job_fields?.job_type)].some((t) => GO_BACK_WORDS.test(t));
}

// ---- outputs ----------------------------------------------------------------------------------------------------

export type Rank = "top" | "mid" | "bottom" | null;

export interface TechRow {
  id: string;
  name: string;
  jobs: number;
  installs: number;
  service: number;
  smallSample: boolean;
  revenueCents: number;
  avgTicketCents: number | null;
  techDays: number;
  revenuePerDayCents: number | null;
  jobsPerDay: number | null;
  onJobHours: number;
  revenuePerHourCents: number | null;
  medianInstallMinutes: number | null;
  medianServiceMinutes: number | null;
  utilizationPct: number | null;
  driveMinutes: number;
  drivePerJobMinutes: number | null;
  driveSharePct: number | null;
  miles: number | null;
  milesPerJob: number | null;
  onTimePct: number | null;
  lateStarts: number;
  itemsPerJob: number | null;
  addOnRatePct: number | null;
  repairAvgTicketCents: number | null;
  goBacks: number;
  goBackRatePct: number | null;
  estimates: number;
  estimatesWon: number;
  closeRatePct: number | null;
  estimateWonCents: number;
  estimatePresentedCents: number;
  avgOptions: number | null;
  outstandingCents: number;
  ranks: Partial<Record<RankedMetric, Rank>>;
}

export type RankedMetric =
  | "revenueCents"
  | "revenuePerDayCents"
  | "revenuePerHourCents"
  | "avgTicketCents"
  | "jobsPerDay"
  | "utilizationPct"
  | "drivePerJobMinutes"
  | "milesPerJob"
  | "onTimePct"
  | "itemsPerJob"
  | "addOnRatePct"
  | "goBackRatePct"
  | "closeRatePct";

/** Lower is better for these. */
const LOWER_IS_BETTER: RankedMetric[] = ["drivePerJobMinutes", "milesPerJob", "goBackRatePct"];
const RANKED: RankedMetric[] = ["revenueCents", "revenuePerDayCents", "revenuePerHourCents", "avgTicketCents", "jobsPerDay", "utilizationPct", "drivePerJobMinutes", "milesPerJob", "onTimePct", "itemsPerJob", "addOnRatePct", "goBackRatePct", "closeRatePct"];

export interface Tiles {
  revenueCents: number;
  jobs: number;
  avgTicketCents: number | null;
  revenuePerTechDayCents: number | null;
  closeRatePct: number | null;
  goBackRatePct: number | null;
  outstandingCents: number;
  afterHoursPct: number | null;
}

export interface Report {
  range: { from: string; to: string; label: string; previousLabel: string | null };
  tiles: Tiles;
  previous: Tiles | null;
  trend: { key: string; label: string; revenueCents: number; jobs: number; avgTicketCents: number | null }[];
  trendBy: "week" | "month";
  mix: {
    byKind: { key: string; jobs: number; revenueCents: number }[];
    byBusinessUnit: { key: string; jobs: number; revenueCents: number }[];
    byJobType: { key: string; jobs: number; revenueCents: number }[];
    afterHours: { jobs: number; revenueCents: number; avgTicketCents: number | null };
  };
  techs: TechRow[];
  medians: Partial<Record<RankedMetric, number | null>>;
  products: { name: string; jobs: number; quantity: number; revenueCents: number }[];
  productMatrix: { products: string[]; rows: { tech: string; counts: number[] }[] };
  goBacks: { number: string; firstNumber: string; techs: string[]; days: number; date: string }[];
  lateStarts: { number: string; tech: string; minutesLate: number; date: string }[];
  byZip: { zip: string; jobs: number; revenueCents: number }[];
  dataNotes: string[];
}

// ---- the engine -------------------------------------------------------------------------------------------------

function companyTiles(jobs: RJob[], estimates: REstimate[], timeZone: string, openHour: number, closeHour: number): Tiles & { _goBacks: number } {
  const done = jobs.filter((j) => isComplete(j) && !isCanceled(j));
  const revenueCents = done.reduce((s, j) => s + cents(j.total_amount), 0);
  const paid = done.filter((j) => cents(j.total_amount) > 0);
  const techDays = new Set<string>();
  for (const j of done) {
    const at = ms(j.work_timestamps?.completed_at) ?? ms(j.schedule?.scheduled_start);
    if (at === null) continue;
    for (const e of j.assigned_employees ?? []) techDays.add(`${e.id}|${wallParts(at, timeZone).day}`);
  }
  const est = estimateStats(estimates, null);
  const goBacks = findGoBacks(jobs).length;
  const after = done.filter((j) => isAfterHours(j, timeZone, openHour, closeHour)).length;
  return {
    revenueCents,
    jobs: done.length,
    avgTicketCents: paid.length ? Math.round(revenueCents / paid.length) : null,
    revenuePerTechDayCents: techDays.size ? Math.round(revenueCents / techDays.size) : null,
    closeRatePct: pct(est.won, est.presented),
    goBackRatePct: pct(goBacks, done.length),
    outstandingCents: done.reduce((s, j) => s + Math.max(0, cents(j.outstanding_balance)), 0),
    afterHoursPct: pct(after, done.length),
    _goBacks: goBacks,
  };
}

function isAfterHours(j: RJob, timeZone: string, openHour: number, closeHour: number): boolean {
  const at = ms(j.schedule?.scheduled_start);
  if (at === null) return false;
  const p = wallParts(at, timeZone);
  return p.weekday === "Sat" || p.weekday === "Sun" || p.hour < openHour || p.hour >= closeHour;
}

function estimateStats(estimates: REstimate[], employeeId: string | null) {
  let presented = 0, won = 0, wonCents = 0, presentedCents = 0, options = 0;
  for (const e of estimates) {
    if (employeeId && !(e.assigned_employees ?? []).some((a) => a.id === employeeId)) continue;
    if (/cancel/i.test(e.work_status ?? "")) continue;
    const opts = Array.isArray(e.options) ? e.options : [];
    if (opts.length === 0) continue;
    presented++;
    options += opts.length;
    const amounts = opts.map((o) => cents(o.total_amount));
    presentedCents += Math.max(0, ...amounts);
    const approved = opts.filter((o) => /approved/i.test(`${o.approval_status ?? ""} ${o.status ?? ""}`) && !/declined|unapproved/i.test(o.approval_status ?? ""));
    const jobMade = /created job/i.test(e.work_status ?? "");
    if (approved.length || jobMade) {
      won++;
      wonCents += approved.length ? approved.reduce((s, o) => s + cents(o.total_amount), 0) : Math.max(0, ...amounts);
    }
  }
  return { presented, won, wonCents, presentedCents, avgOptions: presented ? round1(options / presented) : null };
}

/** Go-backs: [first job, return job] pairs. */
export function findGoBacks(jobs: RJob[]): { first: RJob; back: RJob; days: number }[] {
  const byCustomer = new Map<string, RJob[]>();
  for (const j of jobs) {
    if (isCanceled(j)) continue;
    const key = j.customer?.id ? `c:${j.customer.id}` : j.address?.street && j.address?.zip ? `a:${j.address.street.toLowerCase().trim()}|${j.address.zip}` : null;
    if (!key) continue;
    byCustomer.set(key, [...(byCustomer.get(key) ?? []), j]);
  }
  const out: { first: RJob; back: RJob; days: number }[] = [];
  for (const list of byCustomer.values()) {
    const sorted = list
      .map((j) => ({ j, at: ms(j.schedule?.scheduled_start) }))
      .filter((x): x is { j: RJob; at: number } => x.at !== null)
      .sort((a, b) => a.at - b.at);
    for (let i = 1; i < sorted.length; i++) {
      const back = sorted[i];
      if (!looksLikeGoBack(back.j)) continue;
      // the most recent COMPLETED, paid-for visit before it
      for (let k = i - 1; k >= 0; k--) {
        const first = sorted[k];
        if (!isComplete(first.j) || looksLikeGoBack(first.j)) continue;
        const firstDone = ms(first.j.work_timestamps?.completed_at) ?? first.at;
        const days = (back.at - firstDone) / DAY;
        if (days >= 0 && days <= GO_BACK_DAYS) out.push({ first: first.j, back: back.j, days: Math.round(days) });
        break;
      }
    }
  }
  return out;
}

export function rankAll(rows: TechRow[]): Partial<Record<RankedMetric, number | null>> {
  const medians: Partial<Record<RankedMetric, number | null>> = {};
  const eligible = rows.filter((r) => !r.smallSample);
  for (const m of RANKED) {
    const values = eligible.map((r) => r[m] as number | null).filter((v): v is number => v !== null);
    medians[m] = median(values);
    if (values.length < 3) continue; // ranking two people against each other says nothing
    const sorted = [...values].sort((a, b) => a - b);
    // percentile with linear interpolation, so a small crew still splits sensibly (3 techs: low, middle, high)
    const q = (p: number) => {
      const i = p * (sorted.length - 1);
      const lo = Math.floor(i);
      return sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo);
    };
    const lo = q(0.25);
    const hi = q(0.75);
    const lowerBetter = LOWER_IS_BETTER.includes(m);
    for (const r of eligible) {
      const v = r[m] as number | null;
      if (v === null) continue;
      const good = lowerBetter ? v <= lo : v >= hi;
      const bad = lowerBetter ? v >= hi : v <= lo;
      r.ranks[m] = good && !bad ? "top" : bad && !good ? "bottom" : "mid";
    }
  }
  return medians;
}

const jobNumber = (j: RJob) => (j.invoice_number != null && String(j.invoice_number).trim() ? String(j.invoice_number).trim() : j.id.slice(-6));

export function buildReport(input: ReportInput): Report {
  const { timeZone } = input;
  const openHour = input.openHour ?? 8;
  const closeHour = input.closeHour ?? 17;
  const jobs = input.jobs.filter((j) => !isCanceled(j));
  const done = jobs.filter(isComplete);
  const nameOfId = (id: string) => input.names.get(id) ?? `Technician …${id.slice(-4)}`;

  const tilesFull = companyTiles(jobs, input.estimates, timeZone, openHour, closeHour);
  const { _goBacks: _ignored, ...tiles } = tilesFull;
  void _ignored;
  const previous = input.previousJobs
    ? (({ _goBacks, ...rest }) => (void _goBacks, rest))(companyTiles(input.previousJobs, input.previousEstimates ?? [], timeZone, openHour, closeHour))
    : null;

  // ---- per tech
  type Acc = TechRow & { _ticketJobs: number; _minutes: { install: number[]; service: number[] }; _span: number; _driveJobs: number; _mileJobs: number; _onTimeOf: number; _onTime: number; _itemJobs: number; _items: number; _service: number; _addOn: number; _repairCents: number; _repairJobs: number; _days: Map<string, RJob[]> };
  const accs = new Map<string, Acc>();
  const acc = (id: string): Acc => {
    let a = accs.get(id);
    if (!a) {
      a = {
        id, name: nameOfId(id), jobs: 0, installs: 0, service: 0, smallSample: true, revenueCents: 0, avgTicketCents: null, techDays: 0, revenuePerDayCents: null, jobsPerDay: null, onJobHours: 0, revenuePerHourCents: null,
        medianInstallMinutes: null, medianServiceMinutes: null, utilizationPct: null, driveMinutes: 0, drivePerJobMinutes: null, driveSharePct: null, miles: null, milesPerJob: null, onTimePct: null, lateStarts: 0,
        itemsPerJob: null, addOnRatePct: null, repairAvgTicketCents: null, goBacks: 0, goBackRatePct: null, estimates: 0, estimatesWon: 0, closeRatePct: null, estimateWonCents: 0, estimatePresentedCents: 0, avgOptions: null, outstandingCents: 0, ranks: {},
        _ticketJobs: 0, _minutes: { install: [], service: [] }, _span: 0, _driveJobs: 0, _mileJobs: 0, _onTimeOf: 0, _onTime: 0, _itemJobs: 0, _items: 0, _service: 0, _addOn: 0, _repairCents: 0, _repairJobs: 0, _days: new Map(),
      };
      accs.set(id, a);
    }
    return a;
  };

  const lateStarts: Report["lateStarts"] = [];
  const productTotals = new Map<string, { name: string; jobs: number; quantity: number; revenueCents: number; byTech: Map<string, number> }>();

  for (const j of done) {
    const ids = [...new Set((j.assigned_employees ?? []).map((e) => e.id).filter(Boolean))];
    if (ids.length === 0) continue;
    const total = cents(j.total_amount);
    const share = Math.round(total / ids.length);
    const kind = input.classify(j);
    const started = ms(j.work_timestamps?.started_at);
    const finished = ms(j.work_timestamps?.completed_at);
    const omw = ms(j.work_timestamps?.on_my_way_at);
    const sched = ms(j.schedule?.scheduled_start);
    const onJob = started !== null && finished !== null && finished > started && finished - started <= MAX_JOB_MINUTES * MIN ? (finished - started) / MIN : null;
    const drive = omw !== null && started !== null && started > omw && started - omw <= MAX_DRIVE_MINUTES * MIN && started - omw >= MIN ? (started - omw) / MIN : null;
    const dayAt = finished ?? started ?? sched;
    const items = lineItems(j).filter((i) => i.amountCents > 0);
    const isRepair = kind === "service";

    for (const id of ids) {
      const a = acc(id);
      a.jobs++;
      if (kind === "install") a.installs++;
      else a.service++;
      a.revenueCents += share;
      if (total > 0) a._ticketJobs++;
      a.outstandingCents += Math.round(Math.max(0, cents(j.outstanding_balance)) / ids.length);
      if (onJob !== null) {
        a.onJobHours += onJob / 60;
        a._minutes[kind].push(onJob);
      }
      if (drive !== null) {
        a.driveMinutes += drive;
        a._driveJobs++;
      }
      if (started !== null && sched !== null) {
        a._onTimeOf++;
        const late = (started - sched) / MIN;
        if (late <= ON_TIME_GRACE_MIN) a._onTime++;
        else {
          a.lateStarts++;
          lateStarts.push({ number: jobNumber(j), tech: a.name, minutesLate: Math.round(late), date: wallParts(sched, timeZone).day });
        }
      }
      a._itemJobs++;
      a._items += items.length;
      if (isRepair) {
        a._service++;
        if (items.length >= 2) a._addOn++;
        if (total > 0) {
          a._repairCents += share;
          a._repairJobs++;
        }
      }
      if (dayAt !== null) {
        const day = wallParts(dayAt, timeZone).day;
        a._days.set(day, [...(a._days.get(day) ?? []), j]);
      }
    }

    for (const it of items) {
      const key = productKey(it.name);
      if (!key) continue;
      const p = productTotals.get(key) ?? { name: it.name, jobs: 0, quantity: 0, revenueCents: 0, byTech: new Map<string, number>() };
      p.jobs++;
      p.quantity += it.quantity;
      p.revenueCents += it.amountCents;
      for (const id of ids) p.byTech.set(id, (p.byTech.get(id) ?? 0) + 1);
      productTotals.set(key, p);
    }
  }

  // per day: utilization span and miles
  for (const a of accs.values()) {
    let mileTotal = 0;
    let anyPoints = false;
    let busy = 0;
    for (const dayJobs of a._days.values()) {
      const ordered = dayJobs
        .map((j) => ({ j, start: ms(j.work_timestamps?.started_at), omw: ms(j.work_timestamps?.on_my_way_at), end: ms(j.work_timestamps?.completed_at) }))
        .filter((x) => x.start !== null)
        .sort((x, y) => (x.start as number) - (y.start as number));
      if (ordered.length > 0) {
        const first = Math.min(...ordered.map((x) => x.omw ?? (x.start as number)));
        const last = Math.max(...ordered.map((x) => x.end ?? (x.start as number)));
        if (last > first) a._span += (last - first) / MIN;
        for (const x of ordered) if (x.end !== null && x.end > (x.start as number) && x.end - (x.start as number) <= MAX_JOB_MINUTES * MIN) busy += (x.end - (x.start as number)) / MIN;
      }
      for (let i = 1; i < ordered.length; i++) {
        const p = point(ordered[i - 1].j);
        const q = point(ordered[i].j);
        if (p && q) {
          mileTotal += miles(p, q) * ROAD_MILES_FACTOR;
          a._mileJobs++;
          anyPoints = true;
        }
      }
    }
    a.techDays = a._days.size;
    a.smallSample = a.jobs < MIN_JOBS;
    a.avgTicketCents = a._ticketJobs ? Math.round(a.revenueCents / a._ticketJobs) : null;
    a.revenuePerDayCents = a.techDays ? Math.round(a.revenueCents / a.techDays) : null;
    a.jobsPerDay = a.techDays ? round1(a.jobs / a.techDays) : null;
    a.onJobHours = round1(a.onJobHours);
    a.revenuePerHourCents = a.onJobHours > 0 ? Math.round(a.revenueCents / a.onJobHours) : null;
    a.medianInstallMinutes = median(a._minutes.install) !== null ? Math.round(median(a._minutes.install) as number) : null;
    a.medianServiceMinutes = median(a._minutes.service) !== null ? Math.round(median(a._minutes.service) as number) : null;
    a.utilizationPct = a._span > 0 ? Math.min(100, pct(busy, a._span) as number) : null;
    a.driveMinutes = Math.round(a.driveMinutes);
    a.drivePerJobMinutes = a._driveJobs ? round1(a.driveMinutes / a._driveJobs) : null;
    a.driveSharePct = a._span > 0 ? Math.min(100, pct(a.driveMinutes, a._span) as number) : null;
    a.miles = anyPoints ? Math.round(mileTotal) : null;
    a.milesPerJob = anyPoints && a._mileJobs ? round1(mileTotal / a._mileJobs) : null;
    a.onTimePct = pct(a._onTime, a._onTimeOf);
    a.itemsPerJob = a._itemJobs ? round1(a._items / a._itemJobs) : null;
    a.addOnRatePct = pct(a._addOn, a._service);
    a.repairAvgTicketCents = a._repairJobs ? Math.round(a._repairCents / a._repairJobs) : null;
    const est = estimateStats(input.estimates, a.id);
    a.estimates = est.presented;
    a.estimatesWon = est.won;
    a.closeRatePct = pct(est.won, est.presented);
    a.estimateWonCents = est.wonCents;
    a.estimatePresentedCents = est.presentedCents;
    a.avgOptions = est.avgOptions;
  }

  // techs with estimates but no completed jobs still get a row (estimators)
  for (const e of input.estimates) {
    for (const emp of e.assigned_employees ?? []) {
      if (!emp.id || accs.has(emp.id)) continue;
      const a = acc(emp.id);
      const est = estimateStats(input.estimates, emp.id);
      Object.assign(a, { estimates: est.presented, estimatesWon: est.won, closeRatePct: pct(est.won, est.presented), estimateWonCents: est.wonCents, estimatePresentedCents: est.presentedCents, avgOptions: est.avgOptions });
    }
  }

  // go-backs, charged to the techs on the first visit
  const goBackPairs = findGoBacks(jobs);
  const goBacks: Report["goBacks"] = [];
  for (const { first, back, days } of goBackPairs) {
    const ids = [...new Set((first.assigned_employees ?? []).map((e) => e.id))];
    for (const id of ids) if (accs.has(id)) accs.get(id)!.goBacks++;
    goBacks.push({ number: jobNumber(back), firstNumber: jobNumber(first), techs: ids.map(nameOfId), days, date: wallParts(ms(back.schedule?.scheduled_start) as number, timeZone).day });
  }

  const techs: TechRow[] = [...accs.values()].map((a) => {
    a.goBackRatePct = pct(a.goBacks, a.jobs);
    // drop the working fields
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(a)) if (!k.startsWith("_")) out[k] = v;
    return out as unknown as TechRow;
  });
  const medians = rankAll(techs);
  techs.sort((x, y) => Number(x.smallSample) - Number(y.smallSample) || y.revenueCents - x.revenueCents || x.name.localeCompare(y.name));

  // ---- trend
  const spanDays = (Date.parse(`${input.range.to}T00:00:00Z`) - Date.parse(`${input.range.from}T00:00:00Z`)) / DAY + 1;
  const trendBy: "week" | "month" = spanDays > 92 ? "month" : "week";
  const trendMap = new Map<string, { revenueCents: number; jobs: number; paid: number }>();
  const weekKey = (day: string) => {
    const d = new Date(`${day}T00:00:00Z`);
    const back = (d.getUTCDay() + 6) % 7; // Monday-start weeks
    d.setUTCDate(d.getUTCDate() - back);
    return d.toISOString().slice(0, 10);
  };
  for (const j of done) {
    const at = ms(j.schedule?.scheduled_start);
    if (at === null) continue;
    const p = wallParts(at, timeZone);
    const key = trendBy === "month" ? p.month : weekKey(p.day);
    const t = trendMap.get(key) ?? { revenueCents: 0, jobs: 0, paid: 0 };
    t.revenueCents += cents(j.total_amount);
    t.jobs++;
    if (cents(j.total_amount) > 0) t.paid++;
    trendMap.set(key, t);
  }
  const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const trend = [...trendMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, t]) => ({
      key,
      label: trendBy === "month" ? monthFmt.format(new Date(`${key}-01T00:00:00Z`)) : `Week of ${dayFmt.format(new Date(`${key}T00:00:00Z`))}`,
      revenueCents: t.revenueCents,
      jobs: t.jobs,
      avgTicketCents: t.paid ? Math.round(t.revenueCents / t.paid) : null,
    }));

  // ---- mix
  const group = (keyOf: (j: RJob) => string) => {
    const m = new Map<string, { jobs: number; revenueCents: number }>();
    for (const j of done) {
      const k = keyOf(j);
      const g = m.get(k) ?? { jobs: 0, revenueCents: 0 };
      g.jobs++;
      g.revenueCents += cents(j.total_amount);
      m.set(k, g);
    }
    return [...m.entries()].map(([key, g]) => ({ key, ...g })).sort((a, b) => b.revenueCents - a.revenueCents);
  };
  const afterJobs = done.filter((j) => isAfterHours(j, timeZone, openHour, closeHour));
  const afterRevenue = afterJobs.reduce((s, j) => s + cents(j.total_amount), 0);
  const afterPaid = afterJobs.filter((j) => cents(j.total_amount) > 0).length;

  // ---- products
  const productList = [...productTotals.values()].sort((a, b) => b.revenueCents - a.revenueCents);
  const matrixProducts = productList.slice(0, 8);
  const matrixTechs = techs.filter((t) => t.jobs > 0);

  // ---- zips
  const zipMap = new Map<string, { jobs: number; revenueCents: number }>();
  for (const j of done) {
    const zip = /^\s*(\d{5})/.exec(j.address?.zip ?? "")?.[1];
    if (!zip) continue;
    const z = zipMap.get(zip) ?? { jobs: 0, revenueCents: 0 };
    z.jobs++;
    z.revenueCents += cents(j.total_amount);
    zipMap.set(zip, z);
  }

  // ---- notes about the data itself, so nobody over-trusts a number
  const dataNotes: string[] = [];
  const withTaps = done.filter((j) => ms(j.work_timestamps?.started_at) !== null && ms(j.work_timestamps?.completed_at) !== null).length;
  if (done.length && withTaps / done.length < 0.9) dataNotes.push(`Only ${pct(withTaps, done.length)}% of finished jobs have both a Start and a Finish tap, so time-on-job numbers leave some jobs out.`);
  const withPoints = done.filter((j) => point(j) !== null).length;
  if (done.length && withPoints === 0) dataNotes.push("Housecall Pro sent no map points for these jobs, so miles can't be estimated.");
  else if (done.length && withPoints / done.length < 0.9) dataNotes.push(`Only ${pct(withPoints, done.length)}% of jobs have a map point, so miles are low estimates.`);
  const withItems = done.filter((j) => lineItems(j).length > 0).length;
  if (done.length && withItems === 0) dataNotes.push("No line items came with these jobs, so the product and add-on numbers are empty.");
  if (techs.some((t) => t.smallSample && t.jobs > 0)) dataNotes.push(`Techs with fewer than ${MIN_JOBS} finished jobs in this range are marked "small sample" and not ranked.`);

  return {
    range: input.range,
    tiles,
    previous,
    trend,
    trendBy,
    mix: {
      byKind: group((j) => (input.classify(j) === "install" ? "Installs" : "Service / repair")),
      byBusinessUnit: group((j) => nameOf(j.job_fields?.business_unit) ?? "Not set"),
      byJobType: group((j) => nameOf(j.job_fields?.job_type) ?? "Not set"),
      afterHours: { jobs: afterJobs.length, revenueCents: afterRevenue, avgTicketCents: afterPaid ? Math.round(afterRevenue / afterPaid) : null },
    },
    techs,
    medians,
    products: productList.slice(0, 15).map(({ name, jobs, quantity, revenueCents }) => ({ name, jobs, quantity: round1(quantity), revenueCents })),
    productMatrix: {
      products: matrixProducts.map((p) => p.name),
      rows: matrixTechs.map((t) => ({ tech: t.name, counts: matrixProducts.map((p) => p.byTech.get(t.id) ?? 0) })),
    },
    goBacks: goBacks.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 50),
    lateStarts: lateStarts.sort((a, b) => b.minutesLate - a.minutesLate).slice(0, 30),
    byZip: [...zipMap.entries()].map(([zip, z]) => ({ zip, ...z })).sort((a, b) => b.revenueCents - a.revenueCents).slice(0, 12),
    dataNotes,
  };
}

// ---- ranges -----------------------------------------------------------------------------------------------------

export type RangeKey = "7" | "30" | "90" | "ytd" | "last-month";
export const RANGE_KEYS: RangeKey[] = ["7", "30", "90", "ytd", "last-month"];

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The days a range covers (inclusive, business time zone) and the equal-length period before it. */
export function rangeFor(key: RangeKey, today: string): { from: string; to: string; label: string; previous: { from: string; to: string; label: string } | null } {
  if (key === "ytd") return { from: `${today.slice(0, 4)}-01-01`, to: today, label: "This year so far", previous: null };
  if (key === "last-month") {
    const [y, m] = today.split("-").map(Number);
    const first = new Date(Date.UTC(y, m - 2, 1));
    const last = new Date(Date.UTC(y, m - 1, 0));
    const pFirst = new Date(Date.UTC(y, m - 3, 1));
    const pLast = new Date(Date.UTC(y, m - 2, 0));
    const name = (d: Date) => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
    return {
      from: first.toISOString().slice(0, 10),
      to: last.toISOString().slice(0, 10),
      label: name(first),
      previous: { from: pFirst.toISOString().slice(0, 10), to: pLast.toISOString().slice(0, 10), label: name(pFirst) },
    };
  }
  const n = Number(key);
  const from = addDays(today, -(n - 1));
  return { from, to: today, label: `Last ${n} days`, previous: { from: addDays(from, -n), to: addDays(from, -1), label: `the ${n} days before` } };
}
