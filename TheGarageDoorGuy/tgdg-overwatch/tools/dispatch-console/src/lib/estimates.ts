// Estimate Tracker: the engine. Pure functions (no network, no database) plus a small cached reader, so the rules can
// be tested directly. Nothing here is stored; every answer is worked out from what Housecall Pro says right now.
//
// What an "estimate" looks like in Housecall Pro (verified with scripts/hcp-estimates-probe.mjs against the real account):
//   - one record per estimate VISIT, with work_status, work_timestamps (tech taps), assigned_employees, created_at
//   - one or more OPTIONS (the quotes), each with total_amount (CENTS), approval_status and tags such as "Jasen Est" and "*"
//   - approval_status: approved, pro approved (the office approved for the customer), declined, pro declined, expired, or blank
//   - work_status "created job from estimate" means it became a job
// Customer names are never read into any answer unless ESTIMATE_SHOW_CUSTOMER=on (and then only on the Estimates page).


// ---- what Housecall Pro sends (only the parts we read) -------------------------------------------------

export interface HcpEstimateOption {
  id?: string;
  name?: string;
  total_amount?: number | null;
  approval_status?: string | null;
  status?: string | null;
  tags?: unknown;
}

export interface HcpEstimate {
  id: string;
  estimate_number?: string | number | null;
  work_status?: string | null;
  created_at?: string | null;
  customer?: { first_name?: string | null; last_name?: string | null } | null;
  work_timestamps?: { on_my_way_at?: string | null; started_at?: string | null; completed_at?: string | null } | null;
  assigned_employees?: { id?: string; first_name?: string | null; last_name?: string | null }[] | null;
  options?: HcpEstimateOption[] | null;
}

export interface EstimatePage {
  estimates: HcpEstimate[];
  page: number;
  totalPages: number;
}

/** Read-only access to Housecall Pro's estimate list (newest first). */
export interface EstimateApi {
  listEstimatesPage(page: number, pageSize: number): Promise<EstimatePage>;
}

// ---- settings --------------------------------------------------------------------------------------------

export const DEFAULT_ESTIMATE_URL_TEMPLATE = "https://pro.housecallpro.com/app/estimates/{id}";

export interface EstimateRules {
  /** An office-made estimate with no answer after this many days raises a bar. */
  waitDays: number;
  /** ...and stops raising it after this many (so old, long-dead quotes do not nag forever). */
  waitMaxDays: number;
  /** A tech finishing an estimate is announced for this many hours. */
  finishedHours: number;
  urlTemplate: string;
  /** Tags an option must carry for the estimate to be on the "Jasen Est" list (all of them). */
  listTags: string[];
  /** First day (YYYY-MM-DD, business time zone) of the list and the numbers; null = 1 January of this year. */
  listFrom: string | null;
  showCustomer: boolean;
}

export const DEFAULT_ESTIMATE_RULES: EstimateRules = {
  waitDays: 3,
  waitMaxDays: 14,
  finishedHours: 3,
  urlTemplate: DEFAULT_ESTIMATE_URL_TEMPLATE,
  listTags: ["Jasen Est", "*"],
  listFrom: null,
  showCustomer: false,
};

function wholeNumber(raw: string | undefined, min: number, max: number, fallback: number): number {
  const t = (raw ?? "").trim();
  if (!/^\d+$/.test(t)) return fallback;
  const n = Number(t);
  return n >= min && n <= max ? n : fallback;
}

export function readEstimateRules(env: Record<string, string | undefined> = process.env): EstimateRules {
  const tags = (env.ESTIMATE_LIST_TAGS ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const from = (env.ESTIMATE_LIST_FROM ?? "").trim();
  const waitDays = wholeNumber(env.ESTIMATE_WAIT_DAYS, 1, 60, DEFAULT_ESTIMATE_RULES.waitDays);
  return {
    waitDays,
    waitMaxDays: Math.max(waitDays, wholeNumber(env.ESTIMATE_WAIT_MAX_DAYS, 1, 365, DEFAULT_ESTIMATE_RULES.waitMaxDays)),
    finishedHours: wholeNumber(env.ESTIMATE_FINISHED_HOURS, 1, 12, DEFAULT_ESTIMATE_RULES.finishedHours),
    urlTemplate: validUrlTemplate(env.HCP_ESTIMATE_URL_TEMPLATE) ?? DEFAULT_ESTIMATE_URL_TEMPLATE,
    listTags: tags.length > 0 ? tags : DEFAULT_ESTIMATE_RULES.listTags,
    listFrom: /^\d{4}-\d{2}-\d{2}$/.test(from) && !Number.isNaN(Date.parse(from)) ? from : null,
    showCustomer: (env.ESTIMATE_SHOW_CUSTOMER ?? "").trim().toLowerCase() === "on",
  };
}

/** A link template is usable when it is https, has exactly one {id}, and nothing odd (the same rule as the job link). */
export function validUrlTemplate(raw: string | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!/^https:\/\/[^\s{}]+$/i.test(t.replace("{id}", "")) || t.split("{id}").length !== 2) return null;
  return t;
}

export function estimateUrl(template: string, id: unknown): string | null {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) return null;
  const t = validUrlTemplate(template) ?? DEFAULT_ESTIMATE_URL_TEMPLATE;
  return t.replace("{id}", encodeURIComponent(id));
}

// ---- reading one estimate --------------------------------------------------------------------------------

export type Outcome = "won" | "declined" | "expired" | "open" | "canceled";

const WON = new Set(["approved", "pro approved"]);
const DECLINED = new Set(["declined", "pro declined"]);

const lower = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");

function parseTime(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The options that count: a deleted or canceled option is not a quote anyone is waiting on. */
export function liveOptions(e: HcpEstimate): HcpEstimateOption[] {
  return (Array.isArray(e.options) ? e.options : []).filter((o) => {
    if (!o || typeof o !== "object") return false;
    const s = lower(o.status);
    return s !== "deleted" && !s.includes("cancel");
  });
}

export function isCanceledEstimate(e: HcpEstimate): boolean {
  return lower(e.work_status).includes("cancel");
}

export function becameJob(e: HcpEstimate): boolean {
  return lower(e.work_status).includes("created job");
}

export function optionDecision(o: HcpEstimateOption): "won" | "declined" | "expired" | "none" {
  const s = lower(o.approval_status);
  if (WON.has(s)) return "won";
  if (DECLINED.has(s)) return "declined";
  if (s === "expired") return "expired";
  return "none";
}

export function outcomeOf(e: HcpEstimate): Outcome {
  if (isCanceledEstimate(e)) return "canceled";
  const decisions = liveOptions(e).map(optionDecision);
  if (becameJob(e) || decisions.includes("won")) return "won";
  if (decisions.includes("declined")) return "declined";
  if (decisions.length > 0 && decisions.every((d) => d === "expired")) return "expired";
  return "open";
}

/** True when a tech tapped Start or Finish: the estimate was made in the field rather than typed in at the office. */
export function madeInField(e: HcpEstimate): boolean {
  return Boolean(parseTime(e.work_timestamps?.started_at) || parseTime(e.work_timestamps?.completed_at));
}

const cents = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);

/** What the estimate is worth: the approved options added up, or (while nothing is approved) the biggest option. */
export function valueCents(e: HcpEstimate): number {
  const opts = liveOptions(e);
  const won = opts.filter((o) => optionDecision(o) === "won");
  if (won.length > 0) return won.reduce((sum, o) => sum + cents(o.total_amount), 0);
  return opts.reduce((max, o) => Math.max(max, cents(o.total_amount)), 0);
}

export const money = (c: number) => `$${Math.round(c / 100).toLocaleString("en-US")}`;

export function estimateTechs(e: HcpEstimate): string[] {
  const out: string[] = [];
  for (const a of Array.isArray(e.assigned_employees) ? e.assigned_employees : []) {
    const name = [a?.first_name, a?.last_name].filter((p): p is string => typeof p === "string" && p.trim().length > 0).join(" ").trim();
    if (name) out.push(name.slice(0, 60));
  }
  return out.slice(0, 6);
}

export function estimateLabel(e: HcpEstimate): string {
  const n = e.estimate_number == null ? "" : String(e.estimate_number).replace(/[^A-Za-z0-9-]/g, "").slice(0, 20);
  return n ? `Estimate #${n}` : "Estimate";
}

function dayKey(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function clockLabel(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(d).replace(/ /g, " ");
}
function dateLabel(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(d);
}

// ---- the pop-ups (these ride along in /api/job-watch) -------------------------------------------------

export interface EstimateAlert {
  id: string;
  jobId: string;
  kind: "estimate";
  label: string;
  techs: string[];
  startedAt: string;
  startedLabel: string;
  minutesOnJob: number;
  limitMinutes: number;
  url: string | null;
}

export interface EstimateCompletion {
  id: string;
  jobId: string;
  kind: "estimate";
  label: string;
  techs: string[];
  completedAt: string;
  completedLabel: string;
  minutesOnJob: number | null;
  notes: string[];
  notesPending: boolean;
  notesHidden: boolean;
  url: string | null;
}

const NOTES_PENDING_MINUTES = 10;

export interface EstimateWatch {
  finished: EstimateCompletion[];
  waiting: EstimateAlert[];
}

export function evaluateEstimates(estimates: HcpEstimate[], now: Date, rules: EstimateRules, timeZone: string): EstimateWatch {
  const finished: EstimateCompletion[] = [];
  const waiting: EstimateAlert[] = [];
  for (const e of Array.isArray(estimates) ? estimates : []) {
    if (!e || typeof e !== "object" || typeof e.id !== "string" || !e.id) continue;
    if (isCanceledEstimate(e)) continue;
    const url = estimateUrl(rules.urlTemplate, e.id);

    // 1. a tech has just finished an estimate in the field
    const completedAt = parseTime(e.work_timestamps?.completed_at);
    if (completedAt) {
      const age = now.getTime() - completedAt.getTime();
      if (age >= -5 * 60_000 && age <= rules.finishedHours * 3_600_000) {
        const startedAt = parseTime(e.work_timestamps?.started_at);
        const lines = liveOptions(e).slice(0, 6).map((o) => {
          const name = (typeof o.name === "string" && o.name.trim() ? o.name.trim() : "Option").slice(0, 40);
          const amount = cents(o.total_amount);
          return amount > 0 ? `${name}: ${money(amount)}` : name;
        });
        finished.push({
          id: `${e.id}#${completedAt.getTime()}`,
          jobId: e.id,
          kind: "estimate",
          label: estimateLabel(e),
          techs: estimateTechs(e),
          completedAt: completedAt.toISOString(),
          completedLabel: clockLabel(completedAt, timeZone),
          minutesOnJob: startedAt && completedAt.getTime() >= startedAt.getTime() ? Math.round((completedAt.getTime() - startedAt.getTime()) / 60_000) : null,
          notes: lines,
          notesPending: lines.length === 0 && age < NOTES_PENDING_MINUTES * 60_000,
          notesHidden: false,
          url,
        });
        continue; // a finished field estimate is announced once, not also as "waiting"
      }
    }

    // 2. an estimate typed in at the office that nobody has answered
    if (madeInField(e) || becameJob(e)) continue;
    const created = parseTime(e.created_at);
    if (!created) continue;
    const options = liveOptions(e);
    if (options.length === 0) continue; // nothing was quoted yet
    if (options.some((o) => optionDecision(o) !== "none" && optionDecision(o) !== "expired")) continue; // approved or declined: answered
    const minutes = Math.floor((now.getTime() - created.getTime()) / 60_000);
    if (minutes < rules.waitDays * 1440 || minutes > rules.waitMaxDays * 1440) continue;
    const value = valueCents(e);
    waiting.push({
      id: `${e.id}@${rules.waitDays}d`,
      jobId: e.id,
      kind: "estimate",
      label: value > 0 ? `${estimateLabel(e)} (${money(value)})` : estimateLabel(e),
      techs: estimateTechs(e),
      startedAt: created.toISOString(),
      startedLabel: dateLabel(created, timeZone),
      minutesOnJob: minutes,
      limitMinutes: rules.waitDays * 1440,
      url,
    });
  }
  finished.sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
  waiting.sort((a, b) => b.minutesOnJob - a.minutesOnJob);
  return { finished: finished.slice(0, 10), waiting: waiting.slice(0, 20) };
}

// ---- the Estimates page: the list and the numbers ---------------------------------------------------------

export interface EstimateRow {
  id: string;
  number: string;
  createdAt: string;
  createdLabel: string;
  techs: string[];
  outcome: Outcome;
  amountCents: number;
  /** An amount this large is more likely a typing slip than a real quote: shown, but marked "check". */
  suspect: boolean;
  options: number;
  customer: string | null;
  url: string | null;
  /** A short, stable snapshot of the estimate's state at read time. Compared with the reviewed snapshot to tell
   *  whether the estimate has changed since a dispatcher last looked at it. */
  fingerprint: string;
}

export interface Tally {
  total: number;
  won: number;
  declined: number;
  expired: number;
  open: number;
  canceled: number;
  /** won / (all but canceled), as a whole percent; null when there are none. */
  closeRate: number | null;
  wonCents: number;
}

export interface EstimateReport {
  from: string;
  to: string;
  listTags: string[];
  /** Estimates whose option carries every list tag, newest first. */
  list: EstimateRow[];
  /** The same counts for the list. */
  listTally: Tally;
  /** Every estimate in the period, by month (YYYY-MM) and by tech. */
  byMonth: { key: string; tally: Tally }[];
  byTech: { key: string; tally: Tally }[];
  allTally: Tally;
}

const SUSPECT_CENTS = 10_000_000; // $100,000

function emptyTally(): Tally {
  return { total: 0, won: 0, declined: 0, expired: 0, open: 0, canceled: 0, closeRate: null, wonCents: 0 };
}
function addTo(t: Tally, e: HcpEstimate, outcome: Outcome): void {
  t.total += 1;
  t[outcome] += 1;
  if (outcome === "won") t.wonCents += valueCents(e);
}
function finish(t: Tally): Tally {
  const counted = t.total - t.canceled;
  t.closeRate = counted > 0 ? Math.round((t.won / counted) * 100) : null;
  return t;
}

export function hasAllTags(e: HcpEstimate, tags: string[]): boolean {
  const wanted = tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (wanted.length === 0) return false;
  return liveOptions(e).some((o) => {
    const have = new Set((Array.isArray(o.tags) ? o.tags : []).filter((t): t is string => typeof t === "string").map((t) => t.trim().toLowerCase()));
    return wanted.every((w) => have.has(w));
  });
}

export function buildReport(estimates: HcpEstimate[], now: Date, rules: EstimateRules, timeZone: string): EstimateReport {
  const today = dayKey(now, timeZone);
  const from = rules.listFrom ?? `${today.slice(0, 4)}-01-01`;
  const list: EstimateRow[] = [];
  const listTally = emptyTally();
  const allTally = emptyTally();
  const months = new Map<string, Tally>();
  const techs = new Map<string, Tally>();
  for (const e of estimates) {
    if (!e || typeof e !== "object" || typeof e.id !== "string") continue;
    const created = parseTime(e.created_at);
    if (!created) continue;
    const day = dayKey(created, timeZone);
    if (day < from || day > today) continue;
    const outcome = outcomeOf(e);
    addTo(allTally, e, outcome);
    const month = day.slice(0, 7);
    if (!months.has(month)) months.set(month, emptyTally());
    addTo(months.get(month)!, e, outcome);
    for (const name of estimateTechs(e).slice(0, 1)) {
      if (!techs.has(name)) techs.set(name, emptyTally());
      addTo(techs.get(name)!, e, outcome);
    }
    if (hasAllTags(e, rules.listTags)) {
      addTo(listTally, e, outcome);
      const amount = valueCents(e);
      const customer = rules.showCustomer ? [e.customer?.first_name, e.customer?.last_name].filter((p) => typeof p === "string" && p.trim()).join(" ").slice(0, 60) : "";
      list.push({
        id: e.id,
        number: e.estimate_number == null ? "" : String(e.estimate_number).slice(0, 20),
        createdAt: created.toISOString(),
        createdLabel: dateLabel(created, timeZone),
        techs: estimateTechs(e),
        outcome,
        amountCents: amount,
        suspect: amount >= SUSPECT_CENTS,
        options: liveOptions(e).length,
        customer: rules.showCustomer ? customer || null : null,
        url: estimateUrl(rules.urlTemplate, e.id),
        fingerprint: estimateFingerprint(e),
      });
    }
  }
  list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const sortedMonths = [...months.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([key, tally]) => ({ key, tally: finish(tally) }));
  const sortedTechs = [...techs.entries()].sort((a, b) => b[1].total - a[1].total).map(([key, tally]) => ({ key, tally: finish(tally) }));
  return { from, to: today, listTags: rules.listTags, list: list.slice(0, 500), listTally: finish(listTally), byMonth: sortedMonths, byTech: sortedTechs, allTally: finish(allTally) };
}

// ---- review state (our own: marked reviewed, by whom, when, with a note) ---------------------------------

/** A short, order-independent hash (djb2) of a string. Enough to notice when an estimate's state changes. */
function shortHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * A snapshot of the parts of an estimate worth re-reviewing when they change: its overall outcome, its work status,
 * and each live option's approval status and amount. Not the whole estimate, so a cosmetic edit does not re-flag it.
 */
export function estimateFingerprint(e: HcpEstimate): string {
  const opts = liveOptions(e)
    .map((o) => `${lower(o.approval_status)}|${lower(o.status)}|${cents(o.total_amount)}`)
    .sort();
  return shortHash(`${outcomeOf(e)}#${lower(e.work_status)}#${opts.length}#${opts.join(";")}`);
}

/** One stored review, as the database holds it. */
export interface ReviewRecord {
  reviewedBy: string;
  reviewedAt: string;
  note: string | null;
  reviewedFingerprint: string;
}

/** A list row with its review state merged in. */
export interface ReviewedRow extends EstimateRow {
  reviewed: boolean;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewedAtLabel: string | null;
  note: string | null;
  /** Reviewed once, but the estimate has changed since; it comes back onto the Needs-review list. */
  changedSinceReview: boolean;
  /** Never reviewed, or changed since it was. */
  needsReview: boolean;
}

function reviewedLabel(iso: string, timeZone: string): string {
  const d = parseTime(iso);
  if (!d) return "";
  return `${dateLabel(d, timeZone)}, ${clockLabel(d, timeZone)}`;
}

/** Merge stored reviews onto the list rows. Kept separate from buildReport so review marks show at once,
 *  without waiting for the ten-minute Housecall Pro cache. */
export function mergeReviews(
  rows: EstimateRow[],
  reviews: Record<string, ReviewRecord>,
  timeZone: string
): { rows: ReviewedRow[]; needsReviewCount: number } {
  let needsReviewCount = 0;
  const merged = rows.map((row) => {
    const r = reviews[row.id];
    if (!r) {
      needsReviewCount++;
      return { ...row, reviewed: false, reviewedBy: null, reviewedAt: null, reviewedAtLabel: null, note: null, changedSinceReview: false, needsReview: true };
    }
    const changedSinceReview = r.reviewedFingerprint !== row.fingerprint;
    if (changedSinceReview) needsReviewCount++;
    return {
      ...row,
      reviewed: true,
      reviewedBy: r.reviewedBy,
      reviewedAt: r.reviewedAt,
      reviewedAtLabel: reviewedLabel(r.reviewedAt, timeZone),
      note: r.note,
      changedSinceReview,
      needsReview: changedSinceReview,
    };
  });
  return { rows: merged, needsReviewCount };
}

// ---- export (CSV; the browser turns it into a Google Sheet, Excel sheet or, via print, a PDF) ------------

/** One CSV field, quoted and escaped so commas, quotes and newlines are safe. A leading =,+,-,@ is prefixed with
 *  a quote so a spreadsheet never treats a note as a formula. */
function csvField(value: string | number | null | undefined): string {
  let v = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
}

export const REVIEW_CSV_HEADERS = [
  "Estimate #",
  "Created",
  "Technician",
  "Amount",
  "Outcome",
  "Reviewed",
  "Reviewed by",
  "Reviewed at",
  "Changed since reviewed",
  "Note",
];

const OUTCOME_WORD: Record<Outcome, string> = { won: "Won", open: "Waiting", declined: "Declined", expired: "Expired", canceled: "Canceled" };

/** The review log as CSV text. One row per estimate on the list, with who reviewed it, when, and the note. */
export function reviewLogCsv(rows: ReviewedRow[]): string {
  const lines = [REVIEW_CSV_HEADERS.map(csvField).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.number || "",
        r.createdLabel,
        r.techs.join(", "),
        `$${Math.round(r.amountCents / 100)}`,
        OUTCOME_WORD[r.outcome],
        r.reviewed ? "Yes" : "No",
        r.reviewedBy ?? "",
        r.reviewedAtLabel ?? "",
        r.changedSinceReview ? "Yes" : "",
        r.note ?? "",
      ]
        .map(csvField)
        .join(",")
    );
  }
  return lines.join("\r\n");
}

// ---- asking Housecall Pro (read-only, cached) ---------------------------------------------------------

const PAGE_SIZE = 100;

/** The newest estimates, enough to cover a few weeks: for the pop-ups. */
export async function readRecentEstimates(api: EstimateApi, pages = 2): Promise<HcpEstimate[]> {
  const out: HcpEstimate[] = [];
  for (let page = 1; page <= pages; page++) {
    const res = await api.listEstimatesPage(page, PAGE_SIZE);
    out.push(...res.estimates);
    if (page >= res.totalPages || res.estimates.length < PAGE_SIZE) break;
  }
  return out;
}

/** Everything since `from` (newest first, so it stops at the first page that goes past it). A hard page limit keeps it bounded. */
export async function readEstimatesSince(api: EstimateApi, from: string, timeZone: string, maxPages = 60): Promise<HcpEstimate[]> {
  const out: HcpEstimate[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await api.listEstimatesPage(page, PAGE_SIZE);
    out.push(...res.estimates);
    const oldest = res.estimates.map((e) => parseTime(e?.created_at)).filter((d): d is Date => d !== null).map((d) => dayKey(d, timeZone)).sort()[0];
    if (page >= res.totalPages || res.estimates.length < PAGE_SIZE || (oldest !== undefined && oldest < from)) break;
  }
  return out;
}

type Cached<T> = { at: number; value: T };
const RECENT_TTL_MS = 60_000;
const YEAR_TTL_MS = 10 * 60_000;
let recentCache: Cached<EstimateWatch> | null = null;
let recentFlight: Promise<EstimateWatch> | null = null;
let yearCache: Cached<EstimateReport> | null = null;
let yearFlight: Promise<EstimateReport> | null = null;

/** The pop-up items, cached for a minute so any number of open panels cost one read a minute. */
export async function getEstimateWatch(options: { api: EstimateApi; timeZone: () => string; now?: () => Date; rules?: EstimateRules }): Promise<EstimateWatch> {
  const now = (options.now ?? (() => new Date()))();
  if (recentCache && now.getTime() - recentCache.at < RECENT_TTL_MS && now.getTime() >= recentCache.at) return recentCache.value;
  if (recentFlight) return recentFlight;
  recentFlight = (async () => {
    const rules = options.rules ?? readEstimateRules();
    const estimates = await readRecentEstimates(options.api);
    const value = evaluateEstimates(estimates, now, rules, options.timeZone());
    recentCache = { at: now.getTime(), value };
    return value;
  })().finally(() => {
    recentFlight = null;
  });
  return recentFlight;
}

/** The page's list and numbers, cached for ten minutes (it reads a whole year). */
export async function getEstimateReport(options: { api: EstimateApi; timeZone: () => string; now?: () => Date; rules?: EstimateRules; fresh?: boolean }): Promise<EstimateReport> {
  const now = (options.now ?? (() => new Date()))();
  if (!options.fresh && yearCache && now.getTime() - yearCache.at < YEAR_TTL_MS && now.getTime() >= yearCache.at) return yearCache.value;
  if (yearFlight) return yearFlight;
  yearFlight = (async () => {
    const rules = options.rules ?? readEstimateRules();
    const tz = options.timeZone();
    const from = rules.listFrom ?? `${dayKey(now, tz).slice(0, 4)}-01-01`;
    const estimates = await readEstimatesSince(options.api, from, tz);
    const value = buildReport(estimates, now, rules, tz);
    yearCache = { at: now.getTime(), value };
    return value;
  })().finally(() => {
    yearFlight = null;
  });
  return yearFlight;
}

export function resetEstimateCaches(): void {
  recentCache = null;
  recentFlight = null;
  yearCache = null;
  yearFlight = null;
}
