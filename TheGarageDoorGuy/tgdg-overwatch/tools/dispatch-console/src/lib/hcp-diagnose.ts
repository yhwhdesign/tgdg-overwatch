// "Why isn't this booked time showing?" For one person and one day, ask Housecall Pro what is
// really scheduled, then check, job by job, whether OUR sync would record it and whether our
// database actually has it. Read-only: HCP is only ever read, and nothing is written anywhere.
//
// Output contains staff names, the last 6 characters of job ids, statuses, job type labels and
// times. No customer names, addresses, phone numbers, emails or notes.
//
// Like hcp-sync.ts this module has no runtime imports: everything it needs is passed in.

import type { HcpApi, HcpAppointment, HcpEmployee, HcpJob } from "./hcp-sync";

/**
 * Bumped whenever the report's behavior changes. The script compares this with what it expects, so a
 * dev server still running OLD code is announced instead of failing in confusing ways.
 */
export const DIAGNOSE_VERSION = 3;

const DAY_MS = 86_400_000;

export interface StoredRow {
  hcpJobId: string;
  startTime: Date;
  endTime: Date;
  status: string;
}

export interface StoredLookup {
  technicianFound: boolean;
  rows: StoredRow[];
  /** The most recent time ANY appointment row in our database was written (roughly: the last sync). */
  latestRowUpdate: Date | null;
}

export interface DiagnoseDeps {
  hcp: HcpApi;
  timeZone: string;
  dayBounds: (date: string) => { start: Date; end: Date };
  /** The window the real sync asks HCP for (HCP filters it by each job's first start time). */
  syncWindow: { from: Date; to: Date };
  /** The sync's own job-to-rows rule, so the diagnosis judges the code that actually runs. */
  mapJob: (job: HcpJob) => {
    rows: { hcpEmployeeId: string; startTime: Date; endTime: Date }[];
    skip: string | null;
  };
  loadStored: (hcpEmployeeId: string, start: Date, end: Date) => Promise<StoredLookup>;
  lookbackDays?: number;
  maxAppointmentLookups?: number;
}

export interface DiagnoseItem {
  /** Last 6 characters of the HCP job id. */
  job: string;
  status: string | null;
  jobType: string | null;
  jobSchedule: { start: string; end: string } | null;
  assignedNames: string[];
  /** How many appointments HCP embedded in the job list entry itself. */
  embeddedAppointments: number;
  appointments: {
    start: string;
    end: string;
    anytime: boolean;
    dispatchedNames: string[];
    onThisDay: boolean;
    includesPerson: boolean;
  }[];
  /** True when our sync records this job AND would ask HCP for it, so it blocks this day. */
  ourSyncBlocksThisDay: boolean;
  /** Whether our database currently holds a row for it on this day (null if the person isn't in our database). */
  inDatabase: boolean | null;
  /** HCP refused to show this job's appointments because it is archived (hidden in HCP). */
  archived: boolean;
  /** Any field on the job list entry whose name mentions "archive": tells us whether the list itself reveals archiving. */
  archiveFields: Record<string, string>;
  /** Set when reading this job's appointments failed for another reason. */
  lookupError: string | null;
  notes: string[];
}

export type DiagnoseReport =
  | { ok: false; error: string }
  | {
      ok: true;
      person: { name: string; inDatabase: boolean };
      date: string;
      timeZone: string;
      syncWindow: { from: string; to: string };
      scanned: {
        jobs: number;
        pages: number;
        appointmentLookups: number;
        archivedJobs: number;
        lookupErrors: number;
        lookbackDays: number;
      };
      items: DiagnoseItem[];
      database: {
        rows: { job: string; start: string; end: string; status: string }[];
        latestRowUpdate: string | null;
      };
      findings: string[];
    };

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const fullName = (e: HcpEmployee) => [e.first_name, e.last_name].filter(Boolean).join(" ").trim();
const parse = (v: string | null | undefined): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) =>
  aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();

function labelOf(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const v = value as { name?: unknown; label?: unknown };
    if (typeof v.name === "string") return v.name;
    if (typeof v.label === "string") return v.label;
  }
  return null;
}

async function inChunks<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

export async function diagnoseDay(
  deps: DiagnoseDeps,
  input: { name: string; date: string }
): Promise<DiagnoseReport> {
  const fmtFull = new Intl.DateTimeFormat("en-US", {
    timeZone: deps.timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const fmtTimeOnly = new Intl.DateTimeFormat("en-US", { timeZone: deps.timeZone, hour: "numeric", minute: "2-digit" });
  const when = (d: Date) => fmtFull.format(d);
  const range = (a: Date, b: Date) => `${when(a)} to ${fmtTimeOnly.format(b)}`;

  // ---- who
  const employees = await deps.hcp.listEmployees();
  const nameById = new Map(employees.map((e) => [e.id, fullName(e) || e.id]));
  const query = norm(input.name);
  const matches = employees.filter((e) => norm(fullName(e)).includes(query));
  if (query === "" || matches.length === 0) {
    return {
      ok: false,
      error: `No Housecall Pro employee matches "${input.name}". People: ${employees.map(fullName).join(", ")}.`,
    };
  }
  if (matches.length > 1) {
    return { ok: false, error: `More than one person matches "${input.name}": ${matches.map(fullName).join(", ")}. Use the full name.` };
  }
  const person = matches[0];
  const personName = fullName(person) || person.id;

  // ---- the day
  const day = deps.dayBounds(input.date);
  const lookbackDays = deps.lookbackDays ?? 45;
  const from = new Date(day.start.getTime() - lookbackDays * DAY_MS);
  const to = new Date(day.end.getTime() + 7 * DAY_MS);

  // A multi-day job is listed by when it FIRST starts, so look well back to catch ones already under way.
  const jobs: HcpJob[] = [];
  let pages = 0;
  let totalItems: number | null = null;
  for await (const page of deps.hcp.listJobsInWindow(from, to, { pageSize: 100 })) {
    pages += 1;
    if (totalItems === null) {
      totalItems = page.totalItems;
      if (page.totalItems > 5000) {
        throw new Error(`HCP reports ${page.totalItems} jobs for this range; the date filter was probably ignored. Stopping.`);
      }
    }
    jobs.push(...page.jobs);
    if (pages >= 60) break;
  }

  // ---- which jobs to read appointments for
  const jobTimes = (j: HcpJob) => ({ start: parse(j.schedule?.scheduled_start), end: parse(j.schedule?.scheduled_end) });
  const assignedHas = (j: HcpJob) => (j.assigned_employees ?? []).some((e) => e.id === person.id);
  // A finished or canceled job can't have a visit still to come (and HCP archives finished jobs, then
  // refuses to list their appointments), so the look-back skips them. Jobs near the day are always read.
  const finished = (j: HcpJob) => /^(complete|cancel)/i.test(j.work_status ?? "") || !!j.canceled_at || !!j.deleted_at;
  const candidates = jobs.filter((j) => {
    const { start, end } = jobTimes(j);
    const nearDay = !!start && !!end && end.getTime() >= day.start.getTime() - DAY_MS && start.getTime() <= day.end.getTime() + DAY_MS;
    const recentOrUnscheduled = !end || end.getTime() >= day.start.getTime() - 21 * DAY_MS;
    return nearDay || (assignedHas(j) && recentOrUnscheduled && !finished(j));
  });
  const maxLookups = deps.maxAppointmentLookups ?? 150;
  const toRead = candidates.slice(0, maxLookups);
  const appointmentsByJob = new Map<string, HcpAppointment[]>();
  const archivedJobs = new Set<string>();
  const lookupErrors = new Map<string, string>();
  await inChunks(toRead, 5, async (job) => {
    try {
      appointmentsByJob.set(job.id, await deps.hcp.listAppointments(job.id));
    } catch (err) {
      // One unreadable job must never sink the whole report.
      if ((err as { archived?: boolean } | null)?.archived === true) archivedJobs.add(job.id);
      else lookupErrors.set(job.id, err instanceof Error ? err.message : String(err));
      appointmentsByJob.set(job.id, []);
    }
  });

  // ---- what our database holds for this person and day
  const stored = await deps.loadStored(person.id, day.start, day.end);

  // The sync only looks forward from midnight today, so any earlier day is simply over.
  const dayIsPast = day.end.getTime() <= deps.syncWindow.from.getTime();

  // ---- judge each job
  const items: DiagnoseItem[] = [];
  for (const job of toRead) {
    const { start: jobStart, end: jobEnd } = jobTimes(job);
    const jobOverlaps = !!jobStart && !!jobEnd && overlaps(jobStart, jobEnd, day.start, day.end);
    const appts = (appointmentsByJob.get(job.id) ?? []).map((a) => {
      const start = parse(a.start_time);
      const end = parse(a.end_time);
      const dispatched = a.dispatched_employees_ids ?? [];
      return {
        start,
        end,
        anytime: Boolean(a.anytime),
        dispatched,
        onThisDay: !!start && !!end && overlaps(start, end, day.start, day.end),
      };
    });
    const apptsToday = appts.filter((a) => a.onThisDay);
    const dispatchedHas = apptsToday.some((a) => a.dispatched.includes(person.id));
    const involved = assignedHas(job) || dispatchedHas;
    if (!involved || !(jobOverlaps || apptsToday.length > 0)) continue;

    const mapped = deps.mapJob(job);
    const recordsThisDay =
      !mapped.skip &&
      mapped.rows.some((r) => r.hcpEmployeeId === person.id && overlaps(r.startTime, r.endTime, day.start, day.end));
    const fetchedByWindow = !!jobStart && jobStart.getTime() >= deps.syncWindow.from.getTime() && jobStart.getTime() < deps.syncWindow.to.getTime();
    const blocks = recordsThisDay && fetchedByWindow;
    const inDb = stored.technicianFound ? stored.rows.some((r) => r.hcpJobId === job.id) : null;
    const assignedNames = (job.assigned_employees ?? []).map((e) => nameById.get(e.id) ?? e.id);
    const jobRange = jobStart && jobEnd ? range(jobStart, jobEnd) : "none";

    const isArchived = archivedJobs.has(job.id);
    const lookupError = lookupErrors.get(job.id) ?? null;
    const archiveFields: Record<string, string> = {};
    for (const [key, value] of Object.entries(job as unknown as Record<string, unknown>)) {
      if (/archiv/i.test(key) && (typeof value === "string" || typeof value === "boolean" || typeof value === "number" || value === null)) {
        archiveFields[key] = String(value);
      }
    }

    const notes: string[] = [];
    if (isArchived) {
      notes.push(
        dayIsPast
          ? "ARCHIVED in Housecall Pro: it is finished and hidden there, and this day has already passed, so it no longer blocks anything " +
              "(our sync only looks forward and ignores past days)."
          : "ARCHIVED in Housecall Pro: it is hidden there, so it is not an active booking and should NOT block anyone's time." +
              (blocks
                ? " Our sync still records it (HCP still lists it), so it is showing as a FALSE booking on our screen."
                : "")
      );
    }
    if (lookupError) {
      notes.push(`Could not read this job's appointments (${lookupError}), so only its job-level schedule was checked.`);
    }
    if (blocks) {
      notes.push("Our sync records this job and it blocks the day.");
      if (inDb === false) {
        notes.push(
          "BUT our database does not have it yet. HCP has it and our code would record it, so the data is STALE: " +
            "re-run the sync (and the live updates from HCP aren't reaching us)."
        );
      }
    } else {
      if (mapped.skip) {
        notes.push(`Our sync skips this job (${mapped.skip}).`);
      } else if (!fetchedByWindow) {
        notes.push(
          `Our sync never asks for it: HCP filters by the job's FIRST start (${jobStart ? when(jobStart) : "none"}), which is outside our window ` +
            `(${when(deps.syncWindow.from)} onward). A multi-day job that began earlier is invisible to us.`
        );
      }
      if (apptsToday.length > 0 && !jobOverlaps) {
        notes.push(
          `The visit on this day is a separate appointment (${apptsToday.map((a) => (a.start && a.end ? range(a.start, a.end) : "?")).join("; ")}); ` +
            `we only read the job-level schedule (${jobRange}).`
        );
      }
      if (dispatchedHas && !assignedHas(job)) {
        notes.push(
          `${personName} is dispatched on that appointment but is not in the job's assigned list ` +
            `(${assignedNames.join(", ") || "nobody"}), and we only use the assigned list.`
        );
      }
    }
    if (apptsToday.some((a) => a.anytime)) {
      notes.push('An appointment that day is marked "anytime" (no set hours), so HCP may not report real start/end times for it.');
    }

    items.push({
      job: job.id.slice(-6),
      status: job.work_status ?? null,
      jobType: labelOf(job.job_fields?.job_type),
      jobSchedule: jobStart && jobEnd ? { start: when(jobStart), end: when(jobEnd) } : null,
      assignedNames,
      embeddedAppointments: job.schedule?.appointments?.length ?? 0,
      appointments: appts.map((a) => ({
        start: a.start ? when(a.start) : "?",
        end: a.end ? when(a.end) : "?",
        anytime: a.anytime,
        dispatchedNames: a.dispatched.map((id) => nameById.get(id) ?? id),
        onThisDay: a.onThisDay,
        includesPerson: a.dispatched.includes(person.id),
      })),
      ourSyncBlocksThisDay: blocks,
      inDatabase: inDb,
      archived: isArchived,
      archiveFields,
      lookupError,
      notes,
    });
  }

  // ---- plain-English findings
  const findings: string[] = [];
  if (!stored.technicianFound) {
    findings.push(`${personName} is not in our database at all. Run the sync first.`);
  }
  if (items.length === 0) {
    findings.push(
      `Housecall Pro shows NO job or appointment for ${personName} on this day in the ${lookbackDays} days of jobs I checked. ` +
        "So it may not be a job: an Estimate or a calendar Event (time off, a meeting) is a different kind of item that our sync does not read at all, " +
        "or it could be assigned to someone else, or created after this check."
    );
  }
  for (const item of items) {
    if (item.ourSyncBlocksThisDay && item.inDatabase !== false && !item.archived && !item.lookupError) continue;
    for (const note of item.notes) {
      if (note.startsWith("Our sync records this job and it blocks")) continue;
      findings.push(`Job ...${item.job}: ${note}`);
    }
  }
  const hcpJobIds = new Set(
    toRead.filter((j) => items.some((i) => i.job === j.id.slice(-6))).map((j) => j.id)
  );
  for (const row of stored.rows) {
    if (!hcpJobIds.has(row.hcpJobId)) {
      findings.push(
        `Our database has a row for job ...${row.hcpJobId.slice(-6)} (${range(row.startTime, row.endTime)}) that Housecall Pro no longer shows for ${personName} that day.`
      );
    }
  }
  if (findings.length === 0) {
    findings.push("Housecall Pro and our database agree for this day. If the screen still looks wrong, the problem is in how it draws, not in the data.");
  }

  return {
    ok: true,
    person: { name: personName, inDatabase: stored.technicianFound },
    date: input.date,
    timeZone: deps.timeZone,
    syncWindow: { from: when(deps.syncWindow.from), to: when(deps.syncWindow.to) },
    scanned: {
      jobs: jobs.length,
      pages,
      appointmentLookups: toRead.length,
      archivedJobs: archivedJobs.size,
      lookupErrors: lookupErrors.size,
      lookbackDays,
    },
    items,
    database: {
      rows: stored.rows.map((r) => ({
        job: r.hcpJobId.slice(-6),
        start: when(r.startTime),
        end: fmtTimeOnly.format(r.endTime),
        status: r.status,
      })),
      latestRowUpdate: stored.latestRowUpdate ? when(stored.latestRowUpdate) : null,
    },
    findings,
  };
}
