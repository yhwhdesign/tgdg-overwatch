import type { HcpApi, HcpEmployee, HcpJob } from "./hcp-sync";

// Like the other library files, this one only imports TYPES from its neighbours, so it runs directly on Node in the
// tests. What it needs from the rest of the app arrives as `WatchHelpers` (job-watch-live.ts supplies the real ones).
export interface WatchHelpers {
  /** The business time zone, read each time (it comes from a setting). */
  timeZone(): string;
  /** The start and end of a calendar day (YYYY-MM-DD) in the business time zone. */
  dayBounds(date: string): { start: Date; end: Date };
  isCanceled(job: HcpJob): boolean;
  employeeName(employee: HcpEmployee): string;
  /** A plain-English category that is safe to show to anyone, plus the detail for the server log. */
  describeError(err: unknown): { category: string; detail: string };
}

// Job Watch: "has a technician been on a job longer than normal?"
//
// A tech is ON A JOB when they have tapped Start in the Housecall Pro app (the job has a started_at) and have not
// tapped Finish (no completed_at). The answer comes straight from Housecall Pro each time (nothing is stored, so
// nothing to migrate), cached for a minute so any number of open panels cost one HCP request a minute.
//
// Rules (the user's): an INSTALL is checked once it has run 90 minutes; any other (service) work once it has run 60.
// Settings: JOB_WATCH_INSTALL_MINUTES, JOB_WATCH_SERVICE_MINUTES, JOB_WATCH_INSTALL_WORDS (comma separated).
//
// It also reports jobs that a tech has just FINISHED (tapped Finish in the last few hours), with the job's notes, so
// the office knows if anything further is needed (an estimate to send, a part to order). Nothing is kept: the panel
// shows each one until someone clicks it away.
//
// Things this is careful about:
// - A multi-day install has ONE job-level start time. A job that started on an earlier day is not "on a job right
//   now", so it is ignored (and counted) instead of alerting "26 hours" every morning.
// - It only works when techs tap Start and Finish. A job marked in progress with no start time cannot be judged; it is
//   COUNTED (cantTell), so "nothing to report" can be told apart from "nothing could be checked".
// - Nothing about customers is returned EXCEPT the notes on a job that has just been finished (that is the point of
//   those notifications), and notes can contain customer details such as a gate code. JOB_WATCH_SHOW_NOTES=off turns
//   even that off. Notes are never returned for a job still in progress.

export interface WatchRules {
  installMinutes: number;
  serviceMinutes: number;
  installWords: string[];
  /** How long after a tech taps Finish the job is still announced (hours). */
  completedHours: number;
  /** Include the job's notes in "finished" notifications. */
  showNotes: boolean;
  /** Where "Go to job" leads: an https address with {id} where the job's id goes. */
  jobUrlTemplate: string;
}

/** The address of a job's page in the Housecall Pro web app (it uses the same job_... id the API gives). */
export const DEFAULT_JOB_URL_TEMPLATE = "https://pro.housecallpro.com/app/jobs/{id}";

export const DEFAULT_RULES: WatchRules = { installMinutes: 90, serviceMinutes: 60, installWords: ["install"], completedHours: 3, showNotes: true, jobUrlTemplate: DEFAULT_JOB_URL_TEMPLATE };

function minutesSetting(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && Number.isInteger(n) && n >= 5 && n <= 24 * 60 ? n : fallback;
}

function hoursSetting(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : fallback;
}

export function readWatchRules(env: Record<string, string | undefined> = process.env): WatchRules {
  const words = (env.JOB_WATCH_INSTALL_WORDS ?? "")
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  return {
    installMinutes: minutesSetting(env.JOB_WATCH_INSTALL_MINUTES, DEFAULT_RULES.installMinutes),
    serviceMinutes: minutesSetting(env.JOB_WATCH_SERVICE_MINUTES, DEFAULT_RULES.serviceMinutes),
    installWords: words.length > 0 ? words : DEFAULT_RULES.installWords,
    completedHours: hoursSetting(env.JOB_WATCH_COMPLETED_HOURS, DEFAULT_RULES.completedHours),
    showNotes: !/^(off|false|no|0)$/i.test((env.JOB_WATCH_SHOW_NOTES ?? "").trim()),
    jobUrlTemplate: validJobUrlTemplate(env.HCP_JOB_URL_TEMPLATE) ?? DEFAULT_JOB_URL_TEMPLATE,
  };
}

/** A usable template is https, has no spaces or other braces, and holds {id} exactly once. Otherwise null. */
export function validJobUrlTemplate(raw: string | undefined | null): string | null {
  const t = (raw ?? "").trim();
  if (!/^https:\/\/[^\s{}]+$/i.test(t.replace("{id}", "")) || t.split("{id}").length !== 2) return null;
  return t;
}

/** The address of one job in Housecall Pro, or null when the id is not something we would put in a web address. */
export function jobUrl(template: string | undefined, jobId: unknown): string | null {
  if (typeof jobId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(jobId)) return null;
  const t = validJobUrlTemplate(template) ?? DEFAULT_JOB_URL_TEMPLATE;
  return t.replace("{id}", encodeURIComponent(jobId));
}

// ---- reading what kind of job it is ---------------------------------------------------------------

const TEXT_KEYS = ["name", "title", "label", "value", "text", "description"];

/** Pulls readable text out of a field whose exact shape we have not confirmed: a string, a list, or an object with a name. */
function collectText(value: unknown, out: string[], depth = 0): void {
  if (out.length >= 40 || depth > 3 || value == null) return;
  if (typeof value === "string") {
    if (value.trim()) out.push(value.trim());
  } else if (Array.isArray(value)) {
    for (const item of value.slice(0, 20)) collectText(item, out, depth + 1);
  } else if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of TEXT_KEYS) if (typeof record[key] === "string") collectText(record[key], out, depth + 1);
  }
}

function typeTexts(job: HcpJob): string[] {
  const out: string[] = [];
  collectText(job.job_fields?.job_type, out);
  return out;
}

export function jobTexts(job: HcpJob): string[] {
  const out: string[] = [];
  collectText(job.job_fields?.job_type, out);
  collectText(job.job_fields?.business_unit, out);
  collectText(job.tags, out);
  collectText(job.name, out);
  collectText(job.description, out);
  collectText(job.line_items, out);
  return out;
}

export type JobKind = "install" | "service";

export function classifyJob(job: HcpJob, installWords: string[]): JobKind {
  const haystack = jobTexts(job).join(" \n ").toLowerCase();
  return installWords.some((w) => haystack.includes(w)) ? "install" : "service";
}

/** A short, customer-free name for the job: its type (if Housecall Pro gives one) and its number. */
export function jobLabel(job: HcpJob, kind: JobKind): string {
  const type = typeTexts(job)[0] ?? (() => { const t: string[] = []; collectText(job.tags, t); return t[0]; })();
  const base = (type ?? (kind === "install" ? "Install" : "Service")).replace(/\s+/g, " ").slice(0, 32);
  const number = job.invoice_number != null && String(job.invoice_number).trim() ? ` #${String(job.invoice_number).trim().slice(0, 12)}` : "";
  return `${base}${number}`;
}

// ---- time helpers ---------------------------------------------------------------------------------

function dayKey(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function clockLabel(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(d).replace(/\u202f/g, " ");
}

function parseTime(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---- a job's notes ---------------------------------------------------------------------------------

const NOTE_KEYS = ["content", "text", "note", "body", "message", "description"];
const NOTE_MAX_EACH = 300;
const NOTE_MAX_SHOWN = 3;
const NOTE_MAX_TOTAL = 700;

/** The readable text of a job's notes (a list of notes, in whatever shape), newest last, kept short. */
export function noteTexts(value: unknown): string[] {
  const raw: string[] = [];
  const take = (item: unknown, depth: number) => {
    if (depth > 2 || item == null) return;
    if (typeof item === "string") raw.push(item);
    else if (typeof item === "object") {
      const record = item as Record<string, unknown>;
      for (const key of NOTE_KEYS) {
        if (typeof record[key] === "string" && (record[key] as string).trim()) {
          raw.push(record[key] as string);
          return;
        }
      }
    }
  };
  if (Array.isArray(value)) for (const item of value.slice(-50)) take(item, 0); // the newest notes are last
  else take(value, 0);
  const cleaned = raw.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean).map((t) => (t.length > NOTE_MAX_EACH ? `${t.slice(0, NOTE_MAX_EACH).trimEnd()}...` : t));
  const kept = cleaned.slice(-NOTE_MAX_SHOWN);
  while (kept.length > 1 && kept.join("").length > NOTE_MAX_TOTAL) kept.shift();
  return kept;
}

// ---- the decision ---------------------------------------------------------------------------------

export interface WatchAlert {
  /** Stable for one job at one limit, so a dismissal sticks. */
  id: string;
  jobId: string;
  kind: JobKind;
  label: string;
  techs: string[];
  startedAt: string;
  startedLabel: string;
  minutesOnJob: number;
  limitMinutes: number;
  /** The job's page in Housecall Pro (for "Go to job"), or null. */
  url: string | null;
}

/** A job a tech has just finished, with the job's notes. */
export interface WatchCompletion {
  /** The job and the moment of finishing, so a dismissal sticks to THIS completion. */
  id: string;
  jobId: string;
  kind: JobKind;
  label: string;
  techs: string[];
  completedAt: string;
  completedLabel: string;
  /** Start tap to Finish tap, when both exist. */
  minutesOnJob: number | null;
  /** The job's notes, newest last ([] when there are none, or when notes are switched off). */
  notes: string[];
  /** No notes yet, but the job was finished only minutes ago, so a tech may still be typing them. */
  notesPending: boolean;
  notesHidden: boolean;
  /** The job's page in Housecall Pro (for "Go to job"), or null. */
  url: string | null;
}

/** After this many minutes with no notes, "no notes yet" becomes "no notes were left". */
export const NOTES_PENDING_MINUTES = 10;

export interface WatchSummary {
  /** Jobs a tech is on right now (started today, not finished). */
  watching: number;
  alerts: WatchAlert[];
  /** Marked in progress (or started in the future) but with no usable start time: could not be judged. */
  cantTell: number;
  /** On a job that started on an EARLIER day (such as a multi-day install): not judged. */
  ignoredOlder: number;
  /** Jobs finished within the last few hours, newest first. */
  completed: WatchCompletion[];
}

function techNames(job: HcpJob, nameByHcp: Map<string, string>): string[] {
  const ids = [...new Set((job.assigned_employees ?? []).map((e) => e.id).filter(Boolean))];
  const names = ids.map((id) => nameByHcp.get(id) ?? `Technician …${id.slice(-4)}`);
  return names.length > 0 ? names : ["A technician"];
}

export function evaluateJobs(jobs: HcpJob[], nameByHcp: Map<string, string>, now: Date, rules: WatchRules, helpers: Pick<WatchHelpers, "timeZone" | "isCanceled">): WatchSummary {
  const timeZone = helpers.timeZone();
  const today = dayKey(now, timeZone);
  const summary: WatchSummary = { watching: 0, alerts: [], cantTell: 0, ignoredOlder: 0, completed: [] };

  for (const job of jobs) {
    if (helpers.isCanceled(job)) continue;
    const status = String(job.work_status ?? "").toLowerCase();
    const startedAt = parseTime(job.work_timestamps?.started_at);
    const completedAt = parseTime(job.work_timestamps?.completed_at);
    const finished = Boolean(completedAt) || status.includes("complete");
    if (finished) {
      const age = completedAt ? now.getTime() - completedAt.getTime() : Infinity;
      if (completedAt && age >= -5 * 60_000 && age <= rules.completedHours * 3_600_000) {
        const kind = classifyJob(job, rules.installWords);
        const notes = rules.showNotes ? noteTexts(job.notes) : [];
        const minutesAgo = Math.max(0, Math.floor(age / 60_000));
        summary.completed.push({
          id: `${job.id}#${completedAt.getTime()}`,
          jobId: job.id,
          kind,
          label: jobLabel(job, kind),
          techs: techNames(job, nameByHcp),
          completedAt: completedAt.toISOString(),
          completedLabel: clockLabel(completedAt, timeZone),
          minutesOnJob: startedAt && completedAt.getTime() >= startedAt.getTime() ? Math.round((completedAt.getTime() - startedAt.getTime()) / 60_000) : null,
          notes,
          notesPending: rules.showNotes && notes.length === 0 && minutesAgo < NOTES_PENDING_MINUTES,
          notesHidden: !rules.showNotes,
          url: jobUrl(rules.jobUrlTemplate, job.id),
        });
      }
      continue;
    }

    if (!startedAt) {
      if (status.includes("progress")) summary.cantTell += 1; // says in progress, but nobody tapped Start
      continue;
    }
    if (startedAt.getTime() > now.getTime() + 5 * 60_000) {
      summary.cantTell += 1; // a start time in the future: a clock problem, not something to act on
      continue;
    }
    if (dayKey(startedAt, timeZone) !== today) {
      summary.ignoredOlder += 1;
      continue;
    }

    summary.watching += 1;
    const kind = classifyJob(job, rules.installWords);
    const limitMinutes = kind === "install" ? rules.installMinutes : rules.serviceMinutes;
    const minutesOnJob = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 60_000));
    if (minutesOnJob < limitMinutes) continue;

    summary.alerts.push({
      id: `${job.id}@${limitMinutes}`,
      jobId: job.id,
      kind,
      label: jobLabel(job, kind),
      techs: techNames(job, nameByHcp),
      startedAt: startedAt.toISOString(),
      startedLabel: clockLabel(startedAt, timeZone),
      minutesOnJob,
      limitMinutes,
      url: jobUrl(rules.jobUrlTemplate, job.id),
    });
  }
  summary.alerts.sort((a, b) => b.minutesOnJob - a.minutesOnJob);
  summary.completed.sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
  summary.completed = summary.completed.slice(0, 20);
  return summary;
}

// ---- asking Housecall Pro (read-only, cached) -----------------------------------------------------

export type JobWatchResult =
  | { ok: true; checkedAt: string; watching: number; cantTell: number; ignoredOlder: number; rules: { installMinutes: number; serviceMinutes: number; completedHours: number }; alerts: WatchAlert[]; completed: WatchCompletion[] }
  | { ok: false; checkedAt: string; error: string };

const MAX_PAGES = 10;

/** Yesterday and today (business time zone): a job scheduled late yesterday can still have been started today. */
function readWindow(now: Date, helpers: WatchHelpers): { from: Date; to: Date } {
  const timeZone = helpers.timeZone();
  const today = helpers.dayBounds(dayKey(now, timeZone));
  const yesterday = helpers.dayBounds(dayKey(new Date(today.start.getTime() - 3_600_000), timeZone));
  return { from: yesterday.start, to: today.end };
}

export async function checkJobs(api: HcpApi, now: Date, rules: WatchRules, helpers: WatchHelpers): Promise<JobWatchResult> {
  const checkedAt = now.toISOString();
  try {
    const { from, to } = readWindow(now, helpers);
    const jobs: HcpJob[] = [];
    let pages = 0;
    for await (const page of api.listJobsInWindow(from, to, { pageSize: 100 })) {
      jobs.push(...page.jobs);
      if (++pages >= MAX_PAGES) break;
    }
    const nameByHcp = await employeeNames(api, now, helpers);
    if (rules.showNotes) await addMissingNotes(api, jobs, now, rules, helpers);
    const summary = evaluateJobs(jobs, nameByHcp, now, rules, helpers);
    return { ok: true, checkedAt, watching: summary.watching, cantTell: summary.cantTell, ignoredOlder: summary.ignoredOlder, rules: { installMinutes: rules.installMinutes, serviceMinutes: rules.serviceMinutes, completedHours: rules.completedHours }, alerts: summary.alerts, completed: summary.completed };
  } catch (err) {
    const described = helpers.describeError(err);
    console.error(`[job-watch] check failed: ${described.detail}`);
    const notConnected = err instanceof Error && /HCP_API_KEY is not set/.test(err.message);
    return { ok: false, checkedAt, error: notConnected ? "Housecall Pro is not connected yet (HCP_API_KEY is empty)." : `Could not check: ${described.category}.` };
  }
}

// The job LIST may or may not carry each job's notes. When a just-finished job's entry has no notes field at all, its
// full record is read once (GET /jobs/{id}); a job whose notes field is present, even empty, is never re-read.
// While a finish is fresh a tech may still be typing notes, so a fresh job is re-read on each check instead of cached.
const detailCache = new Map<string, { at: number; notes: unknown }>();
const DETAIL_TTL_MS = 6 * 3_600_000;
const MAX_DETAIL_READS = 10;

async function addMissingNotes(api: HcpApi, jobs: HcpJob[], now: Date, rules: WatchRules, helpers: WatchHelpers): Promise<void> {
  let reads = 0;
  for (const job of jobs) {
    if (job.notes !== undefined || helpers.isCanceled(job)) continue;
    const completedAt = parseTime(job.work_timestamps?.completed_at);
    if (!completedAt) continue;
    const age = now.getTime() - completedAt.getTime();
    if (age < -5 * 60_000 || age > rules.completedHours * 3_600_000) continue;
    const cached = detailCache.get(job.id);
    if (cached && now.getTime() - cached.at < DETAIL_TTL_MS) {
      job.notes = cached.notes;
      continue;
    }
    if (reads >= MAX_DETAIL_READS) continue;
    reads += 1;
    try {
      const full = await api.getJob(job.id);
      const notes = full?.notes ?? [];
      job.notes = notes;
      if (age >= NOTES_PENDING_MINUTES * 60_000) detailCache.set(job.id, { at: now.getTime(), notes });
    } catch {
      /* the notes are a bonus: a failed read just means "no notes" this time, and it is tried again on the next check */
    }
  }
  if (detailCache.size > 300) detailCache.clear();
}

let namesCache: { at: number; names: Map<string, string> } | null = null;
const NAMES_TTL_MS = 60 * 60_000;

async function employeeNames(api: HcpApi, now: Date, helpers: WatchHelpers): Promise<Map<string, string>> {
  if (namesCache && now.getTime() - namesCache.at < NAMES_TTL_MS) return namesCache.names;
  const names = new Map<string, string>();
  for (const e of await api.listEmployees()) names.set(e.id, helpers.employeeName(e));
  namesCache = { at: now.getTime(), names };
  return names;
}

let cache: { at: number; ttl: number; result: JobWatchResult } | null = null;
let inFlight: Promise<JobWatchResult> | null = null;
const OK_TTL_MS = 60_000;
const FAIL_TTL_MS = 15_000;

/** The cached answer, or a fresh one. Many callers at once share a single request to Housecall Pro. */
export async function getJobWatch(options: { api: HcpApi; helpers: WatchHelpers; now?: () => Date; rules?: WatchRules }): Promise<JobWatchResult> {
  const now = (options.now ?? (() => new Date()))();
  if (cache && now.getTime() - cache.at < cache.ttl && now.getTime() >= cache.at) return cache.result;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const result = await checkJobs(options.api, now, options.rules ?? readWatchRules(), options.helpers);
    cache = { at: now.getTime(), ttl: result.ok ? OK_TTL_MS : FAIL_TTL_MS, result };
    return result;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export function resetJobWatchCache(): void {
  cache = null;
  inFlight = null;
  namesCache = null;
  detailCache.clear();
}
