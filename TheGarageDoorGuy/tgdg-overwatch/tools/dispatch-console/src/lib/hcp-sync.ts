// Housecall Pro -> our database.
//
// Everything here is written against the REAL response shapes we probed from
// the HCP API (see scripts/hcp-probe.mjs). This module has no runtime imports:
// it talks to HCP through the small `HcpApi` interface and to the database
// through the small `Db` interface, so it can be tested without either.
//
// Forward-looking only: we mirror from midnight today onward. Anything that
// ended before today is pruned, and jobs outside the window are ignored.
//
// Safety rules baked in:
// - Dry run is the default everywhere; nothing is written unless asked.
// - We only ever pull a date window of jobs, never HCP's full history (an
//   account can hold tens of thousands). If HCP reports an implausibly large
//   result for the window, the filter was ignored and we abort instead of paging.
// - Stale rows are only cleaned up when HCP actually returned jobs.

// ---- HCP shapes (only the fields we use) ----------------------------------

export interface HcpEmployee {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  role?: string | null;
}

/** One visit on a job. A multi-day job (an install, say) has several, each with its own date and hours. */
export interface HcpAppointment {
  id?: string;
  start_time?: string | null;
  end_time?: string | null;
  anytime?: boolean | null;
  arrival_window_minutes?: number | null;
  dispatched_employees_ids?: string[] | null;
}

export interface HcpJob {
  id: string;
  work_status?: string | null;
  canceled_at?: string | null;
  deleted_at?: string | null;
  schedule?: {
    scheduled_start?: string | null;
    scheduled_end?: string | null;
    appointments?: HcpAppointment[] | null;
  } | null;
  assigned_employees?: { id: string }[] | null;
  address?: { zip?: string | null } | null;
  job_fields?: { job_type?: unknown; business_unit?: unknown } | null;
  /** When the tech tapped On my way / Start / Finish in the HCP app (empty until they do). Job Watch reads these. */
  work_timestamps?: { on_my_way_at?: string | null; started_at?: string | null; completed_at?: string | null } | null;
  /** The job number people see in HCP. */
  invoice_number?: string | number | null;
  // Read only to tell an install from service work (see job-watch.ts); never stored or shown.
  name?: unknown;
  description?: unknown;
  tags?: unknown;
  line_items?: unknown;
  /** The job's notes. Job Watch shows them when a tech finishes a job (the shape is read defensively; see noteTexts). */
  notes?: unknown;
}

export interface JobsPage {
  jobs: HcpJob[];
  page: number;
  totalPages: number;
  totalItems: number;
}

export interface HcpApi {
  listEmployees(): Promise<HcpEmployee[]>;
  listJobsInWindow(from: Date, to: Date, opts: { pageSize: number }): AsyncIterable<JobsPage>;
  getJob(id: string): Promise<HcpJob | null>;
  /** The visits (appointments) on one job: GET /jobs/{id}/appointments. */
  listAppointments(jobId: string): Promise<HcpAppointment[]>;
  /** Calendar events (errands, time off, meetings) that may overlap the window: GET /events. */
  listEvents(from: Date, to: Date, opts?: EventsListOptions): Promise<HcpEvent[]>;
}

export interface EventsListOptions {
  /** Called after each page is read, so a long read is never silent. */
  onPage?: (info: { page: number; totalPages: number; totalItems: number }) => void;
  /** Plain-English notes about HOW the read went (for example "stopped early" or "fell back to reading everything"). */
  onNote?: (message: string) => void;
  /** Give up (with a clear error) if reading takes longer than this. */
  budgetMs?: number;
  /** How many days before the window to keep reading (a repeating event is only listed at its FIRST occurrence). */
  lookbackDays?: number;
}

/** A Housecall Pro calendar event. Its exact fields are read defensively; see eventToRows. */
export type HcpEvent = Record<string, unknown>;

// ---- database surface we need ---------------------------------------------

type Row = Record<string, unknown>;

export interface Db {
  technician: {
    findMany(
      args: Row
    ): Promise<Array<{ id: string; hcpEmployeeId: string; name: string; active: boolean; classification?: string | null }>>;
    upsert(args: Row): Promise<unknown>;
    updateMany(args: Row): Promise<{ count: number }>;
  };
  appointment: {
    upsert(args: Row): Promise<unknown>;
    deleteMany(args: Row): Promise<{ count: number }>;
    count(args: Row): Promise<number>;
  };
  webhookEvent: {
    findUnique(args: Row): Promise<{ processed: boolean } | null>;
    upsert(args: Row): Promise<unknown>;
    update(args: Row): Promise<unknown>;
  };
}

export interface SyncDeps {
  db: Db;
  hcp: HcpApi;
}

// ---- pure mapping ----------------------------------------------------------

export function employeeToTechnician(e: HcpEmployee) {
  const name =
    [e.first_name, e.last_name].filter(Boolean).join(" ").trim() || `Employee ${e.id.slice(-6)}`;
  const hcpRole = e.role?.trim() || null;
  // Only field techs are bookable by default. Admins/office staff are still
  // synced (so jobs assigned to them resolve) but start inactive; flip `active`
  // in the database to change that. We never overwrite `active` on later syncs.
  return { hcpEmployeeId: e.id, name, hcpRole, active: (e.role ?? "").trim().toLowerCase() === "field tech" };
}

export type SkipReason = "canceled" | "unscheduled" | "invalid-times" | "no-employees" | "outside-window";

export interface AppointmentRow {
  hcpJobId: string;
  hcpEmployeeId: string;
  startTime: Date;
  endTime: Date;
  status: string;
  zip: string | null;
}

export function isCanceled(job: HcpJob): boolean {
  const status = (job.work_status ?? "").toLowerCase();
  return Boolean(job.canceled_at) || Boolean(job.deleted_at) || status.includes("cancel");
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * One row per assigned technician. HCP's own scheduled block is stored as-is
 * (real start/end); any policy like "treat each job as busy for 1 hour" belongs
 * at read time, not here, so we never lose the truth.
 */
export function jobToAppointmentRows(job: HcpJob): { rows: AppointmentRow[]; skip: SkipReason | null } {
  if (isCanceled(job)) return { rows: [], skip: "canceled" };

  const start = parseDate(job.schedule?.scheduled_start);
  const end = parseDate(job.schedule?.scheduled_end);
  if (!start || !end) return { rows: [], skip: "unscheduled" };
  if (end.getTime() <= start.getTime()) return { rows: [], skip: "invalid-times" };

  const employeeIds = [...new Set((job.assigned_employees ?? []).map((e) => e.id).filter(Boolean))];
  if (employeeIds.length === 0) return { rows: [], skip: "no-employees" };

  // Keep just the 5-digit zip so "72201-1234" and "72201" count as the same place.
  const zip = /^\s*(\d{5})/.exec(job.address?.zip ?? "")?.[1] ?? null;
  const status = job.work_status ?? "scheduled";
  return {
    rows: employeeIds.map((hcpEmployeeId) => ({
      hcpJobId: job.id,
      hcpEmployeeId,
      startTime: start,
      endTime: end,
      status,
      zip,
    })),
    skip: null,
  };
}

const JOB_ID = /^job_[0-9a-f]{32}$/;

/** Finds HCP job ids anywhere in a webhook payload, whatever its exact shape. */
export function extractJobIds(payload: unknown, limit = 5): string[] {
  const found = new Set<string>();
  const walk = (value: unknown, depth: number) => {
    if (found.size >= limit || depth > 6) return;
    if (typeof value === "string") {
      if (JOB_ID.test(value)) found.add(value);
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
    } else if (value && typeof value === "object") {
      for (const item of Object.values(value)) walk(item, depth + 1);
    }
  };
  walk(payload, 0);
  return [...found];
}

// ---- helpers ---------------------------------------------------------------

async function inChunks<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

async function technicianIndex(db: Db) {
  const techs = await db.technician.findMany({
    select: { id: true, hcpEmployeeId: true, name: true, active: true },
  });
  return {
    idByHcp: new Map(techs.map((t) => [t.hcpEmployeeId, t.id])),
    nameByHcp: new Map(techs.map((t) => [t.hcpEmployeeId, t.name])),
  };
}

// ---- employees -------------------------------------------------------------

export interface EmployeesSyncReport {
  dryRun: boolean;
  total: number;
  roles: Record<string, number>;
  created: number;
  updated: number;
  /** Technicians that are (or will be) bookable. */
  activeTechnicians: string[];
}

export async function syncEmployees(
  deps: SyncDeps,
  opts: { dryRun: boolean }
): Promise<{ report: EmployeesSyncReport; employees: HcpEmployee[] }> {
  const employees = await deps.hcp.listEmployees();
  const existing = new Map(
    (
      await deps.db.technician.findMany({
        select: { id: true, hcpEmployeeId: true, name: true, active: true },
      })
    ).map((t) => [t.hcpEmployeeId, t])
  );

  const report: EmployeesSyncReport = {
    dryRun: opts.dryRun,
    total: employees.length,
    roles: {},
    created: 0,
    updated: 0,
    activeTechnicians: [],
  };

  for (const e of employees) {
    const role = (e.role ?? "unknown").toLowerCase();
    report.roles[role] = (report.roles[role] ?? 0) + 1;

    const mapped = employeeToTechnician(e);
    const current = existing.get(e.id);
    if (current) report.updated += 1;
    else report.created += 1;
    if (current ? current.active : mapped.active) report.activeTechnicians.push(mapped.name);

    if (!opts.dryRun) {
      await deps.db.technician.upsert({
        where: { hcpEmployeeId: e.id },
        update: { name: mapped.name, hcpRole: mapped.hcpRole },
        create: mapped,
      });
    }
  }
  return { report, employees };
}

// ---- jobs ------------------------------------------------------------------

interface ApplyResult {
  rows: AppointmentRow[];
  knownRows: AppointmentRow[];
  unknownEmployees: string[];
  skip: SkipReason | null;
}

interface TimeWindow {
  from: Date;
  to: Date;
}

async function applyJob(
  db: Db,
  idByHcp: Map<string, string>,
  job: HcpJob,
  write: boolean,
  window?: TimeWindow
): Promise<ApplyResult> {
  const mapped = jobToAppointmentRows(job);
  const { rows } = mapped;
  let skip: SkipReason | null = mapped.skip;
  // A job entirely outside the window (already finished, or too far ahead) is
  // not something we mirror; treat it like a removal so stale rows disappear.
  if (!skip && window && rows.length > 0) {
    const { startTime, endTime } = rows[0];
    if (endTime.getTime() <= window.from.getTime() || startTime.getTime() >= window.to.getTime()) {
      skip = "outside-window";
    }
  }

  if (skip) {
    // A canceled/unscheduled job must stop blocking anyone's calendar.
    if (write) await db.appointment.deleteMany({ where: { hcpJobId: job.id } });
    return { rows, knownRows: [], unknownEmployees: [], skip };
  }

  const knownRows = rows.filter((r) => idByHcp.has(r.hcpEmployeeId));
  const unknownEmployees = [
    ...new Set(rows.filter((r) => !idByHcp.has(r.hcpEmployeeId)).map((r) => r.hcpEmployeeId)),
  ];

  if (write) {
    const keepTechIds: string[] = [];
    for (const row of knownRows) {
      const technicianId = idByHcp.get(row.hcpEmployeeId) as string;
      keepTechIds.push(technicianId);
      const data = {
        startTime: row.startTime,
        endTime: row.endTime,
        status: row.status,
        zip: row.zip,
        kind: "job",
        label: null,
      };
      await db.appointment.upsert({
        where: { hcpJobId_technicianId: { hcpJobId: row.hcpJobId, technicianId } },
        update: data,
        create: { hcpJobId: row.hcpJobId, technicianId, ...data },
      });
    }
    // Reassigned job: drop rows for techs who are no longer on it.
    await db.appointment.deleteMany({
      where: { hcpJobId: job.id, technicianId: { notIn: keepTechIds } },
    });
  }
  return { rows, knownRows, unknownEmployees, skip: null };
}

export interface JobsSyncReport {
  dryRun: boolean;
  window: { from: string; to: string };
  hcpTotalItems: number | null;
  pagesFetched: number;
  jobsScanned: number;
  appointmentRows: number;
  skipped: Record<string, number>;
  unknownEmployees: string[];
  perTechnician: Record<string, number>;
  staleRows: number;
  /** Past appointments (ended before the window starts) that were, or would be, cleared. */
  prunedPast: number;
  sample: { technician: string; start: string; end: string; status: string }[];
}

export async function syncJobsWindow(
  deps: SyncDeps,
  opts: {
    from: Date;
    to: Date;
    dryRun: boolean;
    /** Employees just fetched from HCP, used to name/recognize techs in a dry run. */
    employees?: HcpEmployee[];
    pageSize?: number;
    maxPages?: number;
    maxTotalItems?: number;
  }
): Promise<JobsSyncReport> {
  const write = !opts.dryRun;
  const pageSize = opts.pageSize ?? 100;
  const maxPages = opts.maxPages ?? 120;
  const maxTotalItems = opts.maxTotalItems ?? 5000;

  const { idByHcp, nameByHcp } = await technicianIndex(deps.db);
  const hcpEmployeeIds = new Set((opts.employees ?? []).map((e) => e.id));
  for (const e of opts.employees ?? []) {
    if (!nameByHcp.has(e.id)) nameByHcp.set(e.id, employeeToTechnician(e).name);
  }
  // In a dry run on a fresh database no technician exists yet; treat anyone HCP
  // lists as "known" so the report reflects what a real run would do.
  const isKnown = (id: string) => idByHcp.has(id) || (opts.dryRun && hcpEmployeeIds.has(id));

  const report: JobsSyncReport = {
    dryRun: opts.dryRun,
    window: { from: opts.from.toISOString(), to: opts.to.toISOString() },
    hcpTotalItems: null,
    pagesFetched: 0,
    jobsScanned: 0,
    appointmentRows: 0,
    skipped: {},
    unknownEmployees: [],
    perTechnician: {},
    staleRows: 0,
    prunedPast: 0,
    sample: [],
  };
  const unknown = new Set<string>();
  const seenJobIds = new Set<string>();

  for await (const page of deps.hcp.listJobsInWindow(opts.from, opts.to, { pageSize })) {
    report.pagesFetched += 1;
    if (report.hcpTotalItems === null) {
      report.hcpTotalItems = page.totalItems;
      if (page.totalItems > maxTotalItems) {
        throw new Error(
          `HCP reports ${page.totalItems} jobs for this window (limit ${maxTotalItems}). ` +
            "The date filter was probably ignored; aborting instead of paging through everything."
        );
      }
    }
    if (report.pagesFetched > maxPages) {
      throw new Error(`Stopped after ${maxPages} pages as a safety limit.`);
    }

    const fresh = page.jobs.filter((j) => !seenJobIds.has(j.id));
    fresh.forEach((j) => seenJobIds.add(j.id));

    await inChunks(fresh, 8, async (job) => {
      report.jobsScanned += 1;
      const result = await applyJob(deps.db, idByHcp, job, write);
      if (result.skip) {
        report.skipped[result.skip] = (report.skipped[result.skip] ?? 0) + 1;
        return;
      }
      for (const id of result.unknownEmployees) {
        if (!isKnown(id)) unknown.add(id);
      }
      const counted = result.rows.filter((r) => isKnown(r.hcpEmployeeId));
      report.appointmentRows += counted.length;
      for (const row of counted) {
        const name = nameByHcp.get(row.hcpEmployeeId) ?? row.hcpEmployeeId;
        report.perTechnician[name] = (report.perTechnician[name] ?? 0) + 1;
        if (report.sample.length < 5) {
          report.sample.push({
            technician: name,
            start: row.startTime.toISOString(),
            end: row.endTime.toISOString(),
            status: row.status,
          });
        }
      }
    });
  }

  report.unknownEmployees = [...unknown];

  // Anything we hold inside this window that HCP no longer lists is stale
  // (moved out of the window, or removed). Never do this off an empty result.
  if (report.jobsScanned > 0 && seenJobIds.size <= 20000) {
    const staleWhere = {
      kind: "job", // never touch events here; they have their own cleanup
      startTime: { gte: opts.from, lte: opts.to },
      hcpJobId: { notIn: [...seenJobIds] },
    };
    report.staleRows = write
      ? (await deps.db.appointment.deleteMany({ where: staleWhere })).count
      : await deps.db.appointment.count({ where: staleWhere });
  }

  // Forward-looking only: drop anything that ended before the window began.
  const pastWhere = { endTime: { lt: opts.from } };
  report.prunedPast = write
    ? (await deps.db.appointment.deleteMany({ where: pastWhere })).count
    : await deps.db.appointment.count({ where: pastWhere });

  return report;
}

/** Re-reads one job from HCP and makes our rows match. Used by the webhook. */
export async function syncSingleJob(
  deps: SyncDeps,
  jobId: string,
  opts: { window?: TimeWindow } = {}
): Promise<{ jobId: string; result: string }> {
  const job = await deps.hcp.getJob(jobId);
  if (!job) {
    await deps.db.appointment.deleteMany({ where: { hcpJobId: jobId } });
    return { jobId, result: "removed (job no longer exists in HCP)" };
  }

  let { idByHcp } = await technicianIndex(deps.db);
  let outcome = await applyJob(deps.db, idByHcp, job, true, opts.window);

  // A job assigned to someone we haven't seen (new hire): refresh the roster, retry once.
  if (outcome.unknownEmployees.length > 0) {
    await syncEmployees(deps, { dryRun: false });
    ({ idByHcp } = await technicianIndex(deps.db));
    outcome = await applyJob(deps.db, idByHcp, job, true, opts.window);
  }

  if (outcome.skip) return { jobId, result: `cleared (${outcome.skip})` };
  return { jobId, result: `synced ${outcome.knownRows.length} technician row(s)` };
}

// ---- calendar events (errands, time off, meetings) -------------------------
//
// An Event blocks a person's time just like a job, but it is a different kind of calendar item and
// its fields were not known when this was written. So the reader is deliberately careful:
// - it only attaches an event to people found under fields that name an assignee (never to a
//   "created by" id), and skips the event, loudly, if it finds none;
// - it never uses a repeat-series end date as the event's end;
// - anything it cannot read is reported with its FIELD NAMES (never values) so it can be fixed.

export interface EventRow {
  /** Stored in the same column as job ids: "event:<id>@<start time>", so it can never collide with a job or another occurrence. */
  hcpEventKey: string;
  hcpEmployeeId: string;
  startTime: Date;
  endTime: Date;
  /** Short title (at most 60 characters), so a dispatcher can see WHY someone is blocked. */
  label: string | null;
}

export type EventSkip = "no-id" | "canceled" | "no-times" | "all-day-dates-only" | "no-duration" | "invalid-times" | "no-employees";

const PRO_ID = /^pro_[0-9a-f]{32}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const SERIES_KEY = /recur|repeat|rrule|series|frequency|until/i;
const START_KEYS = ["start_time", "start", "starts_at", "start_at", "scheduled_start", "start_datetime", "start_date_time", "start_date"];
const END_KEYS = ["end_time", "end", "ends_at", "end_at", "scheduled_end", "end_datetime", "end_date_time", "end_date"];
const ASSIGNEE_KEY = /employee|assign|attendee|dispatch|pro_?ids?$|team|participant/i;
const NOT_ASSIGNEE_KEY = /creat|updat|author|owner|modif|delet|cancel/i;
const LABEL_KEYS = ["name", "title", "summary", "subject", "description"];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Looks at the top level and inside a nested "schedule"-like object, but never inside a repeat series. */
function candidateObjects(event: HcpEvent): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [event];
  for (const [key, value] of Object.entries(event)) {
    if (isObject(value) && /schedule|time|when|window/i.test(key) && !SERIES_KEY.test(key)) out.push(value);
  }
  return out;
}

function findTimeString(event: HcpEvent, names: string[], fallback: RegExp): string | null {
  const objects = candidateObjects(event);
  for (const name of names) {
    for (const obj of objects) {
      const v = obj[name];
      if (typeof v === "string" && (DATETIME.test(v) || DATE_ONLY.test(v))) return v;
    }
  }
  for (const obj of objects) {
    for (const [key, v] of Object.entries(obj)) {
      if (SERIES_KEY.test(key) || !fallback.test(key)) continue;
      if (typeof v === "string" && (DATETIME.test(v) || DATE_ONLY.test(v))) return v;
    }
  }
  return null;
}

function collectProIds(value: unknown, depth: number, out: Set<string>) {
  if (depth > 4) return;
  if (typeof value === "string") {
    if (PRO_ID.test(value)) out.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectProIds(item, depth + 1, out);
  } else if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (NOT_ASSIGNEE_KEY.test(key)) continue;
      collectProIds(item, depth + 1, out);
    }
  }
}

function eventLabel(event: HcpEvent): string | null {
  for (const key of LABEL_KEYS) {
    const v = event[key];
    if (typeof v === "string") {
      const text = v.replace(/\s+/g, " ").trim();
      if (text) return text.length > 60 ? `${text.slice(0, 59)}\u2026` : text;
    }
  }
  return null;
}

export function eventToRows(event: HcpEvent): { rows: EventRow[]; skip: EventSkip | null } {
  const rawId = event.id;
  if (typeof rawId !== "string" || rawId === "") return { rows: [], skip: "no-id" };

  const status = typeof event.status === "string" ? event.status : "";
  if (event.canceled_at || event.cancelled_at || event.deleted_at || /cancel|delet/i.test(status)) {
    return { rows: [], skip: "canceled" };
  }

  const startRaw = findTimeString(event, START_KEYS, /start|begin/i);
  const endRaw = findTimeString(event, END_KEYS, /(^|_)end(s|_|$)|finish/i);
  if (!startRaw || !endRaw) return { rows: [], skip: "no-times" };
  if (DATE_ONLY.test(startRaw) || DATE_ONLY.test(endRaw)) return { rows: [], skip: "all-day-dates-only" };

  const startTime = new Date(startRaw);
  const endTime = new Date(endRaw);
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) return { rows: [], skip: "invalid-times" };
  // An event whose end is its start has no duration, so there is no time to block. Not an error.
  if (endTime.getTime() === startTime.getTime()) return { rows: [], skip: "no-duration" };
  if (endTime.getTime() < startTime.getTime()) return { rows: [], skip: "invalid-times" };

  const ids = new Set<string>();
  for (const [key, value] of Object.entries(event)) {
    if (ASSIGNEE_KEY.test(key) && !NOT_ASSIGNEE_KEY.test(key)) collectProIds(value, 0, ids);
  }
  if (ids.size === 0) return { rows: [], skip: "no-employees" };

  const label = eventLabel(event);
  return {
    // The key includes the start time so that two occurrences sharing one id (a repeating event) can never overwrite each other.
    rows: [...ids].map((hcpEmployeeId) => ({ hcpEventKey: `event:${rawId}@${startTime.toISOString()}`, hcpEmployeeId, startTime, endTime, label })),
    skip: null,
  };
}

// ---- repeating events -------------------------------------------------------
//
// Housecall Pro lists a repeating event ONCE, at its first occurrence, with a rule such as
// "FREQ=WEEKLY;INTERVAL=1;WKST=SU;BYDAY=MO". Without expanding it, only the first Monday would block time.
// This understands daily, weekly and monthly rules (INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY, WKST).
// Anything else is NOT guessed: the event keeps its first occurrence and is reported by name.
// Occurrences keep their local wall-clock time, so a Monday 8:00 AM stays 8:00 AM across daylight saving.

/** How many days before the window the event read looks back. A repeating event is only visible while its FIRST occurrence is this recent. */
export const EVENTS_LOOKBACK_DAYS = 120;

interface Civil {
  y: number;
  m: number;
  d: number;
}

export interface RepeatRule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY";
  interval: number;
  count: number | null;
  /** A plain date is inclusive; a timestamp is an exact instant. */
  until: { date: Civil; time: Date | null } | null;
  /** Weekday numbers are 0 (Sunday) to 6 (Saturday). `ordinal` is for monthly rules ("2TU", "-1FR"). */
  byDay: { ordinal: number | null; day: number }[];
  byMonthDay: number[];
  wkst: number;
}

const WEEKDAY_CODES: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const KNOWN_RULE_PARTS = new Set(["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "WKST"]);

export function parseRepeatRule(text: string): { rule: RepeatRule } | { unsupported: string } {
  const parts = new Map<string, string>();
  for (const piece of text.trim().replace(/^RRULE:/i, "").split(";")) {
    if (piece === "") continue;
    const at = piece.indexOf("=");
    if (at < 1) return { unsupported: `could not read "${piece}"` };
    parts.set(piece.slice(0, at).toUpperCase(), piece.slice(at + 1).trim());
  }
  for (const key of parts.keys()) {
    if (!KNOWN_RULE_PARTS.has(key)) return { unsupported: `uses ${key}, which is not supported yet` };
  }
  const freq = (parts.get("FREQ") ?? "").toUpperCase();
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY") {
    return { unsupported: `repeats ${freq === "" ? "with no frequency" : freq}, which is not supported yet` };
  }
  const whole = (value: string | undefined, fallback: number | null) => {
    if (value === undefined) return fallback;
    return /^\d+$/.test(value) ? Number(value) : Number.NaN;
  };
  const interval = whole(parts.get("INTERVAL"), 1);
  if (interval === null || !Number.isInteger(interval) || interval < 1) return { unsupported: "has an INTERVAL that is not a positive whole number" };
  const count = whole(parts.get("COUNT"), null);
  if (count !== null && (!Number.isInteger(count) || count < 1)) return { unsupported: "has a COUNT that is not a positive whole number" };

  let until: RepeatRule["until"] = null;
  const untilText = parts.get("UNTIL");
  if (untilText !== undefined) {
    if (count !== null) return { unsupported: "has both COUNT and UNTIL" };
    const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(untilText);
    const stamp = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(untilText);
    if (dateOnly) until = { date: { y: Number(dateOnly[1]), m: Number(dateOnly[2]), d: Number(dateOnly[3]) }, time: null };
    else if (stamp) {
      const time = new Date(Date.UTC(Number(stamp[1]), Number(stamp[2]) - 1, Number(stamp[3]), Number(stamp[4]), Number(stamp[5]), Number(stamp[6])));
      until = { date: { y: time.getUTCFullYear(), m: time.getUTCMonth() + 1, d: time.getUTCDate() }, time };
    } else {
      const time = new Date(untilText);
      if (Number.isNaN(time.getTime())) return { unsupported: "has an UNTIL that could not be read" };
      until = { date: { y: time.getUTCFullYear(), m: time.getUTCMonth() + 1, d: time.getUTCDate() }, time };
    }
  }

  const byDay: RepeatRule["byDay"] = [];
  const byDayText = parts.get("BYDAY");
  if (byDayText !== undefined && byDayText !== "") {
    for (const token of byDayText.split(",")) {
      const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(token.trim());
      if (!m) return { unsupported: `has a BYDAY of "${token}" that could not be read` };
      const ordinal = m[1] === undefined ? null : Number(m[1]);
      if (ordinal !== null && freq !== "MONTHLY") return { unsupported: "uses a numbered weekday outside a monthly rule" };
      if (ordinal !== null && (ordinal === 0 || ordinal > 5 || ordinal < -5)) return { unsupported: `has a numbered weekday "${token}" out of range` };
      byDay.push({ ordinal, day: WEEKDAY_CODES[m[2].toUpperCase()] });
    }
    if (freq === "DAILY") return { unsupported: "filters a daily rule by weekday" };
  }
  const byMonthDay: number[] = [];
  const byMonthDayText = parts.get("BYMONTHDAY");
  if (byMonthDayText !== undefined && byMonthDayText !== "") {
    if (freq !== "MONTHLY") return { unsupported: "uses BYMONTHDAY outside a monthly rule" };
    for (const token of byMonthDayText.split(",")) {
      const n = Number(token);
      if (!Number.isInteger(n) || n === 0 || n > 31 || n < -31) return { unsupported: `has a BYMONTHDAY of "${token}" that could not be read` };
      byMonthDay.push(n);
    }
  }
  const wkstText = (parts.get("WKST") ?? "MO").toUpperCase();
  if (!(wkstText in WEEKDAY_CODES)) return { unsupported: `has a WKST of "${wkstText}" that could not be read` };
  return { rule: { freq, interval, count, until, byDay, byMonthDay, wkst: WEEKDAY_CODES[wkstText] } };
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function zonedParts(ms: number, timeZone: string) {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    formatterCache.set(timeZone, f);
  }
  const o: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(ms))) if (part.type !== "literal") o[part.type] = Number(part.value);
  return { y: o.year, m: o.month, d: o.day, hh: o.hour % 24, mm: o.minute, ss: o.second };
}

/** The UTC instant at which the wall clock in `timeZone` reads this date and time. */
function localToUtcMs(c: Civil, hh: number, mm: number, ss: number, timeZone: string): number {
  const asUtc = Date.UTC(c.y, c.m - 1, c.d, hh, mm, ss);
  const offsetAt = (ms: number) => {
    const p = zonedParts(ms, timeZone);
    return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(ms / 1000) * 1000;
  };
  let t = asUtc - offsetAt(asUtc);
  const second = offsetAt(t);
  if (asUtc - second !== t) t = asUtc - second;
  return t;
}

const civilAdd = (c: Civil, days: number): Civil => {
  const t = new Date(Date.UTC(c.y, c.m - 1, c.d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};
const civilWeekday = (c: Civil) => new Date(Date.UTC(c.y, c.m - 1, c.d)).getUTCDay();
const civilNum = (c: Civil) => c.y * 10000 + c.m * 100 + c.d;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The dates a rule produces, in order, starting from the first occurrence's date. Endless; the caller stops it. */
function* occurrenceDates(rule: RepeatRule, start: Civil): Generator<Civil> {
  const MAX_PERIODS = 20000;
  if (rule.freq === "DAILY") {
    for (let k = 0; k < MAX_PERIODS; k++) yield civilAdd(start, k * rule.interval);
  } else if (rule.freq === "WEEKLY") {
    const days = rule.byDay.length > 0 ? rule.byDay.map((b) => b.day) : [civilWeekday(start)];
    const offsets = [...new Set(days.map((d) => (d - rule.wkst + 7) % 7))].sort((a, b) => a - b);
    const firstWeek = civilAdd(start, -((civilWeekday(start) - rule.wkst + 7) % 7));
    for (let k = 0; k < MAX_PERIODS; k++) {
      const weekStart = civilAdd(firstWeek, 7 * rule.interval * k);
      for (const offset of offsets) {
        const date = civilAdd(weekStart, offset);
        if (civilNum(date) >= civilNum(start)) yield date;
      }
    }
  } else {
    for (let k = 0; k < MAX_PERIODS; k++) {
      const index = start.y * 12 + (start.m - 1) + k * rule.interval;
      const y = Math.floor(index / 12);
      const m = (index % 12) + 1;
      const length = daysInMonth(y, m);
      const days = new Set<number>();
      if (rule.byMonthDay.length > 0) {
        for (const n of rule.byMonthDay) {
          const d = n > 0 ? n : length + n + 1;
          if (d >= 1 && d <= length) days.add(d);
        }
      } else if (rule.byDay.length > 0) {
        for (const { ordinal, day } of rule.byDay) {
          const matches: number[] = [];
          for (let d = 1; d <= length; d++) if (civilWeekday({ y, m, d }) === day) matches.push(d);
          if (ordinal === null) matches.forEach((d) => days.add(d));
          else {
            const pick = ordinal > 0 ? matches[ordinal - 1] : matches[matches.length + ordinal];
            if (pick !== undefined) days.add(pick);
          }
        }
      } else if (start.d <= length) {
        days.add(start.d);
      }
      for (const d of [...days].sort((a, b) => a - b)) {
        const date = { y, m, d };
        if (civilNum(date) >= civilNum(start)) yield date;
      }
    }
  }
}

/** Start instants of every occurrence that overlaps the window, wall-clock time kept in `timeZone`. */
export function expandRepeat(
  rule: RepeatRule,
  firstStart: Date,
  durationMs: number,
  timeZone: string,
  window: { from: Date; to: Date },
  cap = 400
): Date[] {
  const p = zonedParts(firstStart.getTime(), timeZone);
  const startCivil: Civil = { y: p.y, m: p.m, d: p.d };
  // Dates well before the window cannot overlap it, so the exact (slower) time math is skipped for them.
  const w = zonedParts(window.from.getTime(), timeZone);
  const lowerBound = civilNum(civilAdd({ y: w.y, m: w.m, d: w.d }, -3));
  const out: Date[] = [];
  let produced = 0;
  for (const date of occurrenceDates(rule, startCivil)) {
    if (civilNum(date) < lowerBound) {
      produced += 1;
      if (rule.count !== null && produced > rule.count) break;
      continue;
    }
    const startMs = localToUtcMs(date, p.hh, p.mm, p.ss, timeZone);
    if (rule.until) {
      if (rule.until.time ? startMs > rule.until.time.getTime() : civilNum(date) > civilNum(rule.until.date)) break;
    }
    produced += 1;
    if (rule.count !== null && produced > rule.count) break;
    if (startMs >= window.to.getTime()) break;
    if (startMs + durationMs > window.from.getTime()) {
      out.push(new Date(startMs));
      if (out.length >= cap) break;
    }
  }
  return out;
}

export interface RepeatInfo {
  /** Last 6 characters of the event id. */
  event: string;
  rule: string;
  firstOccurrence: string;
  /** The date after which a normal read no longer reaches this event's first occurrence (so its repeats would stop showing). */
  visibleUntil: string;
  occurrencesInWindow: number;
  /** Why the rule was not expanded, if it was not (the first occurrence is still used). */
  unsupported: string | null;
}

function validTimeZone(candidate: unknown): string | null {
  if (typeof candidate !== "string" || candidate === "") return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return candidate;
  } catch {
    return null;
  }
}

/** Like eventToRows, but a repeating event yields a row for every occurrence that overlaps the window. */
export function eventToOccurrences(
  event: HcpEvent,
  opts: { from: Date; to: Date; timeZone: string }
): { rows: EventRow[]; skip: EventSkip | null; repeat: RepeatInfo | null } {
  const base = eventToRows(event);
  const rule = event.recurrence_rule;
  if (base.skip || rule === null || rule === undefined || rule === "") return { rows: base.rows, skip: base.skip, repeat: null };

  const first = base.rows[0];
  const ruleText = typeof rule === "string" ? rule : JSON.stringify(rule);
  const info: RepeatInfo = {
    event: String(event.id).slice(-6),
    rule: ruleText.slice(0, 120),
    firstOccurrence: first.startTime.toISOString(),
    visibleUntil: new Date(first.startTime.getTime() + EVENTS_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10),
    occurrencesInWindow: 0,
    unsupported: null,
  };
  const overlapsWindow = (start: Date, durationMs: number) => start.getTime() < opts.to.getTime() && start.getTime() + durationMs > opts.from.getTime();
  const duration = first.endTime.getTime() - first.startTime.getTime();
  const parsed = typeof rule === "string" ? parseRepeatRule(rule) : { unsupported: "the repeat rule is not text" };
  if ("unsupported" in parsed) {
    info.unsupported = parsed.unsupported;
    info.occurrencesInWindow = overlapsWindow(first.startTime, duration) ? 1 : 0;
    return { rows: base.rows, skip: null, repeat: info };
  }

  const scheduleZone = (event.schedule as { time_zone?: unknown } | undefined)?.time_zone;
  const timeZone = validTimeZone(scheduleZone) ?? opts.timeZone;
  const starts = new Map<number, Date>();
  // The occurrence HCP lists is real even if the rule would not have produced it.
  starts.set(first.startTime.getTime(), first.startTime);
  for (const s of expandRepeat(parsed.rule, first.startTime, duration, timeZone, opts)) starts.set(s.getTime(), s);
  const rows: EventRow[] = [];
  for (const start of [...starts.values()].sort((a, b) => a.getTime() - b.getTime())) {
    if (overlapsWindow(start, duration)) info.occurrencesInWindow += 1;
    for (const r of base.rows) {
      rows.push({ ...r, hcpEventKey: `event:${event.id as string}@${start.toISOString()}`, startTime: start, endTime: new Date(start.getTime() + duration) });
    }
  }
  return { rows, skip: null, repeat: info };
}

/** What we can say about an event we could not read, without any names, notes or addresses. */
export interface UnreadableEvent {
  /** Last 6 characters of the event id. */
  event: string;
  reason: string;
  start: string | null;
  end: string | null;
  allDay: boolean | null;
  /** The repeat rule text, if any (a pattern, not personal information). */
  recurrenceRule: string | null;
  assigned: number | null;
  createdAt: string | null;
  fields: string[];
}

function describeUnreadable(event: HcpEvent, reason: EventSkip): UnreadableEvent {
  const rule = event.recurrence_rule;
  const assigned = Object.entries(event).find(([k, v]) => ASSIGNEE_KEY.test(k) && !NOT_ASSIGNEE_KEY.test(k) && Array.isArray(v));
  return {
    event: String(event.id ?? "?").slice(-6),
    reason,
    start: findTimeString(event, START_KEYS, /start|begin/i),
    end: findTimeString(event, END_KEYS, /(^|_)end(s|_|$)|finish/i),
    allDay: typeof event.all_day === "boolean" ? event.all_day : null,
    recurrenceRule: rule == null ? null : (typeof rule === "string" ? rule : JSON.stringify(rule)).slice(0, 120),
    assigned: assigned ? (assigned[1] as unknown[]).length : null,
    createdAt: typeof event.created_at === "string" ? event.created_at : null,
    fields: Object.keys(event).slice(0, 40),
  };
}

export interface EventsSyncReport {
  dryRun: boolean;
  /** List entries read from HCP (every event it has, because HCP ignores the date range). */
  fetched: number;
  /** Distinct event ids among them. */
  distinct: number;
  /** Entries whose id was already seen earlier in the list. */
  duplicateEntries: number;
  /** Pages read, how many HCP has in all, the total events HCP has, and how long reading took. */
  pages: number;
  totalPages: number | null;
  totalItems: number | null;
  seconds: number;
  /** How the read went, in plain English (for example that it stopped early, or fell back to reading everything). */
  notes: string[];
  /** Distinct events that produced at least one row inside the window. */
  usable: number;
  rows: number;
  skipped: Record<string, number>;
  unknownEmployees: string[];
  perTechnician: Record<string, number>;
  staleRows: number;
  sample: { technician: string; start: string; end: string; label: string | null }[];
  /** Events we could not read, with their times and flags (never names, notes or addresses). */
  unreadable: UnreadableEvent[];
  /** Repeating events: how many were found, how many occurrences fall in the window, and any rule we could not expand. */
  repeating: { series: number; occurrencesInWindow: number; details: RepeatInfo[] };
}

export async function syncEventsWindow(
  deps: SyncDeps,
  opts: { from: Date; to: Date; dryRun: boolean; employees?: HcpEmployee[]; log?: (message: string) => void; timeZone?: string }
): Promise<EventsSyncReport> {
  const write = !opts.dryRun;
  const { idByHcp, nameByHcp } = await technicianIndex(deps.db);
  const hcpEmployeeIds = new Set((opts.employees ?? []).map((e) => e.id));
  for (const e of opts.employees ?? []) {
    if (!nameByHcp.has(e.id)) nameByHcp.set(e.id, employeeToTechnician(e).name);
  }
  const isKnown = (id: string) => idByHcp.has(id) || (opts.dryRun && hcpEmployeeIds.has(id));

  // Look a week back so an event that began earlier and is still running is not missed.
  const startedAt = Date.now();
  let pages = 0;
  let totalPages: number | null = null;
  let totalItems: number | null = null;
  const notes: string[] = [];
  // The client decides how far back to look (it reads forward by start time and stops at the window).
  const events = await deps.hcp.listEvents(opts.from, opts.to, {
    lookbackDays: EVENTS_LOOKBACK_DAYS,
    onPage: (p) => {
      pages += 1;
      totalPages = p.totalPages;
      totalItems = p.totalItems;
      opts.log?.(`[events] read page ${p.page} of ${p.totalPages} (${p.totalItems} events in all)`);
    },
    onNote: (message) => {
      notes.push(message);
      opts.log?.(`[events] ${message}`);
    },
  });
  if (pages === 0) pages = events.length > 0 ? 1 : 0;

  const report: EventsSyncReport = {
    dryRun: opts.dryRun,
    fetched: events.length,
    distinct: 0,
    duplicateEntries: 0,
    pages,
    totalPages,
    totalItems,
    seconds: Math.round((Date.now() - startedAt) / 100) / 10,
    notes,
    usable: 0,
    rows: 0,
    skipped: {},
    unknownEmployees: [],
    perTechnician: {},
    staleRows: 0,
    sample: [],
    unreadable: [],
    repeating: { series: 0, occurrencesInWindow: 0, details: [] },
  };
  const unknown = new Set<string>();
  const idsSeen = new Set<string>();
  const usableKeys = new Set<string>();
  const rowKeys = new Set<string>();
  const windowKeys = new Set<string>();

  for (const event of events) {
    if (typeof event.id === "string") {
      if (idsSeen.has(event.id)) report.duplicateEntries += 1;
      idsSeen.add(event.id);
    }
    const { rows, skip, repeat } = eventToOccurrences(event, { from: opts.from, to: opts.to, timeZone: opts.timeZone ?? "America/Chicago" });
    if (repeat) {
      report.repeating.series += 1;
      report.repeating.occurrencesInWindow += repeat.occurrencesInWindow;
      if (report.repeating.details.length < 10) report.repeating.details.push(repeat);
    }
    if (skip) {
      report.skipped[skip] = (report.skipped[skip] ?? 0) + 1;
      if (skip !== "canceled" && skip !== "no-duration" && report.unreadable.length < 10) report.unreadable.push(describeUnreadable(event, skip));
      // A canceled event must stop blocking anyone (every occurrence of it).
      if (skip === "canceled" && write && typeof event.id === "string") {
        await deps.db.appointment.deleteMany({ where: { hcpJobId: { startsWith: `event:${event.id}@` } } });
      }
      continue;
    }

    // keep only what overlaps the window we mirror
    const inWindow = rows.filter((r) => r.endTime.getTime() > opts.from.getTime() && r.startTime.getTime() < opts.to.getTime());
    if (inWindow.length === 0) continue;

    const keepByKey = new Map<string, string[]>();
    for (const row of inWindow) {
      usableKeys.add(row.hcpEventKey);
      if (!keepByKey.has(row.hcpEventKey)) keepByKey.set(row.hcpEventKey, []);
      if (!isKnown(row.hcpEmployeeId)) {
        unknown.add(row.hcpEmployeeId);
        continue;
      }
      windowKeys.add(row.hcpEventKey);
      const pairKey = `${row.hcpEventKey}|${row.hcpEmployeeId}`;
      if (!rowKeys.has(pairKey)) {
        rowKeys.add(pairKey);
        const name = nameByHcp.get(row.hcpEmployeeId) ?? row.hcpEmployeeId;
        report.perTechnician[name] = (report.perTechnician[name] ?? 0) + 1;
        if (report.sample.length < 5) {
          report.sample.push({ technician: name, start: row.startTime.toISOString(), end: row.endTime.toISOString(), label: row.label });
        }
      }
      const technicianId = idByHcp.get(row.hcpEmployeeId);
      if (write && technicianId) {
        keepByKey.get(row.hcpEventKey)!.push(technicianId);
        const data = { startTime: row.startTime, endTime: row.endTime, status: "event", zip: null, kind: "event", label: row.label };
        await deps.db.appointment.upsert({
          where: { hcpJobId_technicianId: { hcpJobId: row.hcpEventKey, technicianId } },
          update: data,
          create: { hcpJobId: row.hcpEventKey, technicianId, ...data },
        });
      }
    }
    // Someone was taken off an occurrence: drop their row for it.
    if (write) {
      for (const [key, keep] of keepByKey) {
        await deps.db.appointment.deleteMany({ where: { hcpJobId: key, technicianId: { notIn: keep } } });
      }
    }
  }
  report.distinct = idsSeen.size;
  report.usable = usableKeys.size;
  report.rows = rowKeys.size;
  report.unknownEmployees = [...unknown];

  // Event rows we hold inside the window that HCP no longer lists. Only the events that fall inside the
  // window matter here (so the list stays short), never off an empty answer, and never touching jobs.
  if (events.length > 0) {
    const staleWhere = {
      kind: "event",
      startTime: { gte: opts.from, lte: opts.to },
      hcpJobId: { notIn: [...windowKeys] },
    };
    report.staleRows = write
      ? (await deps.db.appointment.deleteMany({ where: staleWhere })).count
      : await deps.db.appointment.count({ where: staleWhere });
  }
  report.seconds = Math.round((Date.now() - startedAt) / 100) / 10;
  return report;
}

// ---- housekeeping ------------------------------------------------------------

export async function retireDemoTechnician(db: Db, opts: { dryRun: boolean }): Promise<number> {
  if (opts.dryRun) return 0;
  const res = await db.technician.updateMany({
    where: { hcpEmployeeId: "demo-tech-1" },
    data: { active: false },
  });
  return res.count;
}
