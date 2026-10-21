import type { HcpApi, HcpJob } from "./hcp-sync";

// Weekend recap: "what happened on the jobs while nobody was in the office?"
//
// The window is Friday 6:00 PM to Sunday 10:00 PM in the business time zone (after-hours and weekend work). For each
// job worked in that window it shows who did it, how it ended, and the techs' NOTES, because the techs cannot
// convert a job into an estimate: whatever else is needed (parts to order, a return visit, a quote) is written in
// the notes. Jobs that look like they need the office are listed first, with the words that raised the flag:
//   - the notes mention something like parts, order, need, return, quote, waiting, call back (WEEKEND_RECAP_WORDS)
//   - a finished job has NO notes at all (nothing says whether anything else is needed)
//   - a job was never finished (still "in progress" hours later, or its scheduled time passed and nobody started it)
// A flag is a hint to look, not a verdict ("no parts needed" also contains "parts"), so the words are shown.
//
// Read-only against Housecall Pro; nothing is stored. Like the other library files this one only imports TYPES from
// its neighbours (weekend-recap-live.ts supplies the real helpers), so it runs directly on Node in tests. It must
// not import anything with a Node-only dependency because the page also uses highlightParts().

export type JobKind = "install" | "service";

export interface RecapHelpers {
  timeZone(): string;
  isCanceled(job: HcpJob): boolean;
  classify(job: HcpJob): JobKind;
  label(job: HcpJob, kind: JobKind): string;
  url(jobId: string): string | null;
  techNames(job: HcpJob, names: Map<string, string>): string[];
  employeeNames(): Promise<Map<string, string>>;
  describeError(err: unknown): { category: string; detail: string };
}

export interface RecapRules {
  /** Words or short phrases that make a job "worth a look" when they appear in its notes. */
  words: string[];
  /** false when JOB_WATCH_SHOW_NOTES is off: jobs are still listed but their notes are not read or shown. */
  showNotes: boolean;
}

export const DEFAULT_WORDS: string[] = [
  "part", "parts", "order", "ordered", "ordering", "special order", "backorder", "back order",
  "need", "needs", "needed", "will need",
  "return", "go back", "come back", "back out", "follow up", "follow-up", "call back", "callback", "call customer",
  "quote", "estimate", "bid", "recommend", "recommended",
  "waiting", "wait", "on hold", "schedule", "reschedule",
  "unable", "couldn't", "could not", "didn't", "did not", "not have", "no power",
];

const MAX_WORDS = 60;

/** WEEKEND_RECAP_WORDS (comma separated) replaces the default list; junk entries are dropped; nothing usable means the default. */
export function readRecapRules(env: Record<string, string | undefined>, showNotes: boolean): RecapRules {
  const raw = (env.WEEKEND_RECAP_WORDS ?? "").trim();
  if (!raw) return { words: DEFAULT_WORDS, showNotes };
  const words = [...new Set(raw.split(",").map((w) => w.trim().toLowerCase().replace(/\s+/g, " ")).filter((w) => w.length >= 2 && w.length <= 40))].slice(0, MAX_WORDS);
  return { words: words.length > 0 ? words : DEFAULT_WORDS, showNotes };
}

// ---- time ------------------------------------------------------------------------------------------

interface Civil {
  y: number;
  m: number;
  d: number;
}

function offsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** The moment a wall-clock time happens in a time zone (right across daylight-saving changes). */
export function zonedTime(c: Civil, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(c.y, c.m - 1, c.d, hour, minute);
  const first = guess - offsetMs(guess, timeZone);
  return new Date(guess - offsetMs(first, timeZone));
}

function civilOf(at: Date, timeZone: string): Civil {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

function civilAdd(c: Civil, days: number): Civil {
  const t = new Date(Date.UTC(c.y, c.m - 1, c.d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

const civilWeekday = (c: Civil) => new Date(Date.UTC(c.y, c.m - 1, c.d)).getUTCDay();

const clock = (d: Date, timeZone: string) => new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(d).replace(/ /g, " ");
const dayClock = (d: Date, timeZone: string) => `${new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(d)} ${clock(d, timeZone)}`;
const dayDate = (d: Date, timeZone: string) => new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(d);
const hourOnly = (d: Date, timeZone: string) => clock(d, timeZone).replace(":00", "");

export interface RecapWindow {
  start: Date;
  end: Date;
  /** "Fri Oct 16, 6 PM to Sun Oct 18, 10 PM" */
  label: string;
  /** The weekend is going on right now. */
  isCurrent: boolean;
  /** 0 = the latest weekend that has started, 1 = the one before, and so on. */
  back: number;
}

export const MAX_BACK = 8;

/** Friday 6:00 PM to Sunday 10:00 PM. `back` = how many weekends to step back from the latest one that has started. */
export function weekendWindow(now: Date, back: number, timeZone: string): RecapWindow {
  const steps = Number.isInteger(back) ? Math.min(Math.max(back, 0), MAX_BACK) : 0;
  const today = civilOf(now, timeZone);
  const sinceFriday = (civilWeekday(today) - 5 + 7) % 7;
  let friday = civilAdd(today, -sinceFriday);
  if (sinceFriday === 0 && now.getTime() < zonedTime(friday, 18, 0, timeZone).getTime()) friday = civilAdd(friday, -7); // Friday daytime: the weekend has not started yet
  friday = civilAdd(friday, -7 * steps);
  const start = zonedTime(friday, 18, 0, timeZone);
  const end = zonedTime(civilAdd(friday, 2), 22, 0, timeZone);
  return {
    start,
    end,
    label: `${dayDate(start, timeZone)}, ${hourOnly(start, timeZone)} to ${dayDate(end, timeZone)}, ${hourOnly(end, timeZone)}`,
    isCurrent: now.getTime() >= start.getTime() && now.getTime() <= end.getTime(),
    back: steps,
  };
}

function parseTime(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---- notes and words ------------------------------------------------------------------------------

const NOTE_KEYS = ["content", "text", "note", "body", "message", "description"];
const NOTE_MAX_EACH = 1000;
const NOTE_MAX_SHOWN = 8;
const NOTE_MAX_TOTAL = 4000;

/** The readable text of a job's notes (any shape), oldest first, kept to a sensible length. More is kept than Job Watch shows: the office reads these to decide what to do. */
export function recapNotes(value: unknown): string[] {
  const raw: string[] = [];
  const take = (item: unknown) => {
    if (item == null) return;
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
  if (Array.isArray(value)) for (const item of value.slice(-50)) take(item);
  else take(value);
  const cleaned = raw.map((t) => t.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim()).filter(Boolean).map((t) => (t.length > NOTE_MAX_EACH ? `${t.slice(0, NOTE_MAX_EACH).trimEnd()}...` : t));
  const kept = cleaned.slice(-NOTE_MAX_SHOWN);
  while (kept.length > 1 && kept.join("").length > NOTE_MAX_TOTAL) kept.shift();
  return kept;
}

function pattern(words: string[]): RegExp | null {
  const parts = [...new Set(words.map((w) => w.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+").replace(/'/g, "['\u2019]"));
  // no look-behind (older Safari cannot read one): the character before the word is matched as group 1 instead
  return parts.length === 0 ? null : new RegExp(`(^|[^\\p{L}\\p{N}])(${parts.join("|")})(?![\\p{L}\\p{N}])`, "giu");
}

/** Which of the words appear in the text (whole words only, any case), in the order of the list. */
export function matchedWords(text: string, words: string[]): string[] {
  const hits = new Set<string>();
  const re = pattern(words);
  if (!re) return [];
  const normalized = (w: string) => w.trim().toLowerCase().replace(/\s+/g, " ").replace(/\u2019/g, "'");
  for (const m of text.matchAll(re)) hits.add(normalized(m[2]));
  return words.map(normalized).filter((w, i, all) => all.indexOf(w) === i && hits.has(w));
}

/** The text cut into pieces, marking which pieces are flagged words (for highlighting). */
export function highlightParts(text: string, words: string[]): { text: string; hit: boolean }[] {
  const re = pattern(words);
  if (!re || !text) return [{ text, hit: false }];
  const out: { text: string; hit: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = (m.index ?? 0) + m[1].length;
    if (at > last) out.push({ text: text.slice(last, at), hit: false });
    out.push({ text: m[2], hit: true });
    last = at + m[2].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out.length > 0 ? out : [{ text, hit: false }];
}

// ---- the decision ---------------------------------------------------------------------------------

export type RecapState = "finished" | "in-progress" | "not-started" | "upcoming";
export type RecapReason = "words" | "no-notes" | "unfinished";

export interface RecapItem {
  id: string;
  kind: JobKind;
  label: string;
  techs: string[];
  state: RecapState;
  /** "Sat 10:14 AM": when it was finished, started, or scheduled. */
  whenLabel: string;
  whenAt: string;
  minutesOnJob: number | null;
  notes: string[];
  /** The flagged words found in the notes. */
  words: string[];
  reasons: RecapReason[];
  needsLook: boolean;
  url: string | null;
}

export interface RecapCounts {
  total: number;
  finished: number;
  needsLook: number;
  withWords: number;
  noNotes: number;
  unfinished: number;
}

export const IN_PROGRESS_STALE_HOURS = 6;
const MAX_ITEMS = 200;

export function evaluateRecap(jobs: HcpJob[], names: Map<string, string>, window: RecapWindow, now: Date, rules: RecapRules, helpers: Pick<RecapHelpers, "timeZone" | "isCanceled" | "classify" | "label" | "url" | "techNames">): { items: RecapItem[]; counts: RecapCounts } {
  const timeZone = helpers.timeZone();
  const inWindow = (d: Date | null) => d !== null && d.getTime() >= window.start.getTime() && d.getTime() <= window.end.getTime();
  const items: RecapItem[] = [];
  const seen = new Set<string>();

  for (const job of jobs) {
    if (!job || typeof job.id !== "string" || seen.has(job.id) || helpers.isCanceled(job)) continue;
    const startedAt = parseTime(job.work_timestamps?.started_at);
    const completedAt = parseTime(job.work_timestamps?.completed_at);
    const scheduled = parseTime(job.schedule?.scheduled_start);
    if (!inWindow(startedAt) && !inWindow(completedAt) && !inWindow(scheduled)) continue;
    seen.add(job.id);

    const status = String(job.work_status ?? "").toLowerCase();
    const finished = completedAt !== null || status.includes("complete");
    const stateNow: RecapState = finished ? "finished" : startedAt ? "in-progress" : scheduled && scheduled.getTime() > now.getTime() ? "upcoming" : "not-started";
    const kind = helpers.classify(job);
    const notes = rules.showNotes ? recapNotes(job.notes) : [];
    const words = notes.length > 0 ? matchedWords(notes.join("\n"), rules.words) : [];
    const reasons: RecapReason[] = [];
    if (words.length > 0) reasons.push("words");
    if (rules.showNotes && finished && notes.length === 0) reasons.push("no-notes");
    const staleInProgress = stateNow === "in-progress" && startedAt !== null && now.getTime() - startedAt.getTime() > IN_PROGRESS_STALE_HOURS * 3_600_000;
    if (stateNow === "not-started" || staleInProgress) reasons.push("unfinished");

    const when = completedAt ?? startedAt ?? scheduled ?? window.start;
    items.push({
      id: job.id,
      kind,
      label: helpers.label(job, kind),
      techs: helpers.techNames(job, names),
      state: stateNow,
      whenLabel: dayClock(when, timeZone),
      whenAt: when.toISOString(),
      minutesOnJob: startedAt && completedAt && completedAt.getTime() >= startedAt.getTime() ? Math.round((completedAt.getTime() - startedAt.getTime()) / 60_000) : null,
      notes,
      words,
      reasons,
      needsLook: reasons.length > 0,
      url: helpers.url(job.id),
    });
  }

  items.sort((a, b) => Number(b.needsLook) - Number(a.needsLook) || Date.parse(a.whenAt) - Date.parse(b.whenAt));
  const shown = items.slice(0, MAX_ITEMS);
  return {
    items: shown,
    counts: {
      total: items.length,
      finished: items.filter((i) => i.state === "finished").length,
      needsLook: items.filter((i) => i.needsLook).length,
      withWords: items.filter((i) => i.reasons.includes("words")).length,
      noNotes: items.filter((i) => i.reasons.includes("no-notes")).length,
      unfinished: items.filter((i) => i.reasons.includes("unfinished")).length,
    },
  };
}

// ---- asking Housecall Pro (read-only, cached) -----------------------------------------------------

export type RecapResult =
  | { ok: true; checkedAt: string; window: { start: string; end: string; label: string; isCurrent: boolean; back: number }; notesHidden: boolean; words: string[]; counts: RecapCounts; items: RecapItem[] }
  | { ok: false; checkedAt: string; error: string };

const MAX_PAGES = 10;
const MAX_DETAIL_READS = 25;
const DETAIL_TTL_MS = 6 * 3_600_000;
const detailCache = new Map<string, { at: number; notes: unknown }>();

async function addMissingNotes(api: HcpApi, jobs: HcpJob[], window: RecapWindow, now: Date, helpers: Pick<RecapHelpers, "isCanceled">): Promise<void> {
  let reads = 0;
  for (const job of jobs) {
    if (job.notes !== undefined || helpers.isCanceled(job)) continue;
    const completedAt = parseTime(job.work_timestamps?.completed_at);
    if (!completedAt || completedAt.getTime() < window.start.getTime() || completedAt.getTime() > window.end.getTime()) continue;
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
      detailCache.set(job.id, { at: now.getTime(), notes });
    } catch {
      /* the notes are a bonus: a failed read just means "no notes" this time, and it is tried again on the next check */
    }
  }
  if (detailCache.size > 500) detailCache.clear();
}

export async function checkRecap(api: HcpApi, now: Date, back: number, rules: RecapRules, helpers: RecapHelpers): Promise<RecapResult> {
  const checkedAt = now.toISOString();
  try {
    const window = weekendWindow(now, back, helpers.timeZone());
    const jobs: HcpJob[] = [];
    let pages = 0;
    // Housecall Pro filters by a job's first scheduled start, so reach back a day before the window opens.
    for await (const page of api.listJobsInWindow(new Date(window.start.getTime() - 24 * 3_600_000), window.end, { pageSize: 100 })) {
      jobs.push(...page.jobs);
      if (++pages >= MAX_PAGES) break;
    }
    const names = await helpers.employeeNames();
    if (rules.showNotes) await addMissingNotes(api, jobs, window, now, helpers);
    const { items, counts } = evaluateRecap(jobs, names, window, now, rules, helpers);
    return { ok: true, checkedAt, window: { start: window.start.toISOString(), end: window.end.toISOString(), label: window.label, isCurrent: window.isCurrent, back: window.back }, notesHidden: !rules.showNotes, words: rules.words, counts, items };
  } catch (err) {
    const described = helpers.describeError(err);
    console.error(`[weekend-recap] check failed: ${described.detail}`);
    const notConnected = err instanceof Error && /HCP_API_KEY is not set/.test(err.message);
    return { ok: false, checkedAt, error: notConnected ? "Housecall Pro is not connected yet (HCP_API_KEY is empty)." : `Could not check: ${described.category}.` };
  }
}

const cache = new Map<number, { at: number; ttl: number; result: RecapResult }>();
const inFlight = new Map<number, Promise<RecapResult>>();
const OK_TTL_MS = 5 * 60_000;
const FAIL_TTL_MS = 15_000;

/** The cached answer for that weekend, or a fresh one. Many callers at once share a single request to Housecall Pro. */
export async function getWeekendRecap(options: { api: HcpApi; helpers: RecapHelpers; rules: RecapRules; back?: number; now?: () => Date; fresh?: boolean }): Promise<RecapResult> {
  const now = (options.now ?? (() => new Date()))();
  const back = Number.isInteger(options.back) ? Math.min(Math.max(options.back as number, 0), MAX_BACK) : 0;
  const hit = cache.get(back);
  if (!options.fresh && hit && now.getTime() - hit.at < hit.ttl && now.getTime() >= hit.at) return hit.result;
  const running = inFlight.get(back);
  if (running) return running;
  const job = (async () => {
    const result = await checkRecap(options.api, now, back, options.rules, options.helpers);
    cache.set(back, { at: now.getTime(), ttl: result.ok ? OK_TTL_MS : FAIL_TTL_MS, result });
    return result;
  })().finally(() => {
    inFlight.delete(back);
  });
  inFlight.set(back, job);
  return job;
}

export function resetWeekendRecapCache(): void {
  cache.clear();
  inFlight.clear();
  detailCache.clear();
}
