// Housecall Pro API client (read-only). Requires the account to be on the MAX plan.
//
// Verified against the real API with scripts/hcp-probe.mjs: list responses look
// like { page, page_size, total_pages, total_items, jobs|employees: [...] }.
// Docs and third-party specs disagree on whether the key goes in
// "Authorization: Token <key>" or "Bearer <key>", so we try both once and
// remember whichever works (override the first guess with HCP_AUTH_SCHEME).

import type { EventsListOptions, HcpApi, HcpAppointment, HcpEmployee, HcpEvent, HcpJob, JobsPage } from "./hcp-sync";

const BASE_URL = process.env.HCP_BASE_URL || "https://api.housecallpro.com";

type Scheme = "Token" | "Bearer";
let resolvedScheme: Scheme | null = null;

function schemeOrder(): Scheme[] {
  if (resolvedScheme) return [resolvedScheme];
  return process.env.HCP_AUTH_SCHEME === "Bearer" ? ["Bearer", "Token"] : ["Token", "Bearer"];
}

/** An error response from HCP. `archived` is true for HCP's "Archived job" refusal (a finished, hidden job). */
export class HcpApiError extends Error {
  status: number;
  archived: boolean;
  constructor(message: string, status: number, archived = false) {
    super(message);
    this.name = "HcpApiError";
    this.status = status;
    this.archived = archived;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function rawGet(path: string): Promise<Response> {
  const key = process.env.HCP_API_KEY;
  if (!key) throw new Error("HCP_API_KEY is not set");

  let lastAuthStatus: number | null = null;
  for (const scheme of schemeOrder()) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${BASE_URL}${path}`, {
        headers: { Authorization: `${scheme} ${key}`, Accept: "application/json" },
        cache: "no-store",
      });
      if (res.status === 429) {
        if (attempt >= 3) throw new Error("HCP rate limit hit repeatedly (HTTP 429); try again shortly.");
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep((Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** attempt) * 1000);
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        lastAuthStatus = res.status;
        break; // try the other header style
      }
      resolvedScheme = scheme;
      return res;
    }
  }
  throw new Error(
    `HCP rejected the API key (HTTP ${lastAuthStatus ?? "?"}). Check HCP_API_KEY and that the key is not revoked.`
  );
}

/** HCP answers 400 {"error":{"message":"Archived job"}} for a job that has been archived (hidden). */
async function isArchivedResponse(res: Response): Promise<boolean> {
  if (res.status !== 400) return false;
  return /archived/i.test(await res.clone().text());
}

async function getJson<T>(path: string): Promise<T> {
  const res = await rawGet(path);
  if (!res.ok) throw new Error(`HCP API error ${res.status} on ${path.split("?")[0]}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

interface ListResponse {
  page?: number;
  total_pages?: number;
  total_items?: number;
  employees?: HcpEmployee[];
  jobs?: HcpJob[];
}

async function listEmployees(): Promise<HcpEmployee[]> {
  const all: HcpEmployee[] = [];
  for (let page = 1; ; page++) {
    const data = await getJson<ListResponse>(`/employees?page=${page}&page_size=100`);
    all.push(...(data.employees ?? []));
    if (page >= (data.total_pages ?? 1)) return all;
  }
}

async function* listJobsInWindow(from: Date, to: Date, opts: { pageSize: number }): AsyncGenerator<JobsPage> {
  for (let page = 1; ; page++) {
    const qs = new URLSearchParams({
      page: String(page),
      page_size: String(opts.pageSize),
      scheduled_start_min: from.toISOString(),
      scheduled_start_max: to.toISOString(),
    });
    const data = await getJson<ListResponse>(`/jobs?${qs}`);
    const jobs = data.jobs ?? [];
    const totalPages = data.total_pages ?? 1;
    yield { jobs, page, totalPages, totalItems: data.total_items ?? jobs.length };
    if (page >= totalPages) return;
  }
}

async function getJob(id: string): Promise<HcpJob | null> {
  const res = await rawGet(`/jobs/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (await isArchivedResponse(res)) return null; // an archived job is hidden in HCP: treat it as gone
  if (!res.ok) throw new Error(`HCP API error ${res.status} on /jobs/{id}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as HcpJob;
}

async function listAppointments(jobId: string): Promise<HcpAppointment[]> {
  const res = await rawGet(`/jobs/${encodeURIComponent(jobId)}/appointments`);
  if (res.status === 404) return [];
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    throw new HcpApiError(
      `HCP API error ${res.status} on /jobs/{id}/appointments: ${body}`,
      res.status,
      res.status === 400 && /archived/i.test(body)
    );
  }
  const data = (await res.json()) as { appointments?: HcpAppointment[] };
  return data.appointments ?? [];
}

// GET /events takes start_date and end_date plus page/page_size. We try plain dates first, then full
// timestamps, and remember whichever HCP accepts. If HCP ignores the dates and reports a huge result
// we stop instead of paging through every event it has ever had.
let eventDateFormat: "date" | "timestamp" | null = null;
const DAY_MS = 86_400_000;

function firstArray<T>(json: unknown): T[] {
  if (Array.isArray(json)) return json as T[];
  if (json && typeof json === "object") {
    for (const value of Object.values(json)) if (Array.isArray(value)) return value as T[];
  }
  return [];
}

const EVENT_PAGE_SIZE = 100;
const EVENT_MAX_PAGES = 100;
const EVENT_PAGES_AT_ONCE = 3;
const EVENT_BUDGET_MS = 150_000;
/** Forward reading goes this far back before the window unless the caller says otherwise (a repeating event is only listed at its first occurrence). */
const EVENT_LOOKBACK_DEFAULT_DAYS = 120;

/** An error that retrying another way cannot fix. */
const fatal = (message: string) => Object.assign(new Error(message), { fatal: true });
/** Forward reading cannot be trusted right now: read everything instead. */
const needFullRead = (message: string) => Object.assign(new Error(message), { needFullRead: true });

/** When an event starts, wherever HCP puts it (the real shape nests it under `schedule`). */
function eventStartMs(event: HcpEvent): number {
  const schedule = event.schedule as { start_time?: unknown } | undefined;
  const raw = schedule?.start_time ?? event.start_time ?? event.start;
  return typeof raw === "string" ? new Date(raw).getTime() : NaN;
}

/**
 * Reads events newest-START-first (HCP supports `sort_by=start_time&sort_direction=desc`) and stops as soon
 * as it reaches events that began before the window (minus a lookback). Housecall Pro ignores date filters
 * on this list, so without this we would read every event it has ever had (thousands) on every sync.
 * Three guards keep it honest: the very first request must be accepted, every event must really arrive in
 * non-increasing start order, and a page with no readable start never counts as "reached the past".
 */
async function listEventsForward(from: Date, opts: EventsListOptions): Promise<HcpEvent[]> {
  const budgetMs = opts.budgetMs ?? EVENT_BUDGET_MS;
  const startedAt = Date.now();
  const cutoff = from.getTime() - (opts.lookbackDays ?? EVENT_LOOKBACK_DEFAULT_DAYS) * DAY_MS;
  const fetchPage = (page: number) => {
    const qs = new URLSearchParams({ sort_by: "start_time", sort_direction: "desc", page: String(page), page_size: String(EVENT_PAGE_SIZE) });
    return getJson<{ total_pages?: number; total_items?: number }>(`/events?${qs}`);
  };

  let first: { total_pages?: number; total_items?: number };
  try {
    first = await fetchPage(1);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/ 400 /.test(message)) throw needFullRead(`HCP refused to sort events by start time (${message})`);
    throw err;
  }
  const totalPages = first.total_pages ?? 1;
  const totalItems = first.total_items ?? 0;

  const collected: HcpEvent[] = [];
  let previousStart = Number.POSITIVE_INFINITY;
  /** Takes one page in order. Returns true once we have reached events from before the cutoff. */
  const take = (page: number, events: HcpEvent[]): boolean => {
    let reachedPast = false;
    for (const event of events) {
      const start = eventStartMs(event);
      if (Number.isFinite(start)) {
        if (start > previousStart) throw needFullRead("events did not arrive in start order");
        previousStart = start;
        if (start < cutoff) reachedPast = true;
      }
      collected.push(event);
    }
    opts.onPage?.({ page, totalPages, totalItems });
    return reachedPast;
  };

  let lastPage = 1;
  let done = take(1, firstArray<HcpEvent>(first));
  for (let next = 2; !done && next <= Math.min(totalPages, EVENT_MAX_PAGES); next += EVENT_PAGES_AT_ONCE) {
    if (Date.now() - startedAt > budgetMs) {
      throw fatal(`reading events took longer than ${Math.round(budgetMs / 1000)} seconds (read ${lastPage} of ${totalPages} pages)`);
    }
    const batch = Array.from({ length: Math.min(EVENT_PAGES_AT_ONCE, Math.min(totalPages, EVENT_MAX_PAGES) - next + 1) }, (_, i) => next + i);
    const results = await Promise.all(batch.map(fetchPage));
    for (let i = 0; i < batch.length && !done; i++) {
      done = take(batch[i], firstArray<HcpEvent>(results[i]));
      lastPage = batch[i];
    }
  }
  opts.onNote?.(
    done
      ? `read forward by start time and stopped after page ${lastPage} of ${totalPages} (reached events from before the window)`
      : `read forward by start time through all ${totalPages} pages (never reached events from before the window)`
  );
  return collected;
}

/** The fallback: HCP ignores date ranges here, so this reads EVERY event and lets the caller keep what overlaps. */
async function listEventsFull(from: Date, to: Date, opts: EventsListOptions): Promise<HcpEvent[]> {
  const budgetMs = opts.budgetMs ?? EVENT_BUDGET_MS;
  const startedAt = Date.now();
  const formats: ("date" | "timestamp")[] = eventDateFormat ? [eventDateFormat] : ["date", "timestamp"];
  let lastError = "no attempt made";
  for (const format of formats) {
    // Plain dates are widened by a day each side; the caller keeps only what overlaps its window.
    const start = format === "date" ? new Date(from.getTime() - DAY_MS).toISOString().slice(0, 10) : from.toISOString();
    const end = format === "date" ? new Date(to.getTime() + DAY_MS).toISOString().slice(0, 10) : to.toISOString();
    const fetchPage = (page: number) => {
      const qs = new URLSearchParams({ start_date: start, end_date: end, page: String(page), page_size: String(EVENT_PAGE_SIZE) });
      return getJson<{ total_pages?: number; total_items?: number }>(`/events?${qs}`);
    };
    try {
      const first = await fetchPage(1);
      const firstEvents = firstArray<HcpEvent>(first);
      const totalPages = first.total_pages ?? 1;
      const totalItems = first.total_items ?? firstEvents.length;
      // HCP ignores the date range, so a large account means a large read. Refuse a runaway.
      if (totalPages > EVENT_MAX_PAGES) {
        throw fatal(`HCP reports ${totalItems} events (${totalPages} pages), more than we will read each time; the date filter is not narrowing the list`);
      }
      opts.onPage?.({ page: 1, totalPages, totalItems });

      const pages: HcpEvent[][] = [firstEvents];
      const remaining = Array.from({ length: Math.max(0, totalPages - 1) }, (_, i) => i + 2);
      for (let i = 0; i < remaining.length; i += EVENT_PAGES_AT_ONCE) {
        if (Date.now() - startedAt > budgetMs) {
          throw fatal(`reading events took longer than ${Math.round(budgetMs / 1000)} seconds (read ${pages.length} of ${totalPages} pages)`);
        }
        const batch = remaining.slice(i, i + EVENT_PAGES_AT_ONCE);
        const results = await Promise.all(batch.map(fetchPage));
        results.forEach((result, j) => {
          pages[batch[j] - 1] = firstArray<HcpEvent>(result);
          opts.onPage?.({ page: batch[j], totalPages, totalItems });
        });
      }
      eventDateFormat = format;
      return pages.flat();
    } catch (err) {
      if ((err as { fatal?: boolean }).fatal) throw err;
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(`HCP would not list events: ${lastError}`);
}

async function listEvents(from: Date, to: Date, opts: EventsListOptions = {}): Promise<HcpEvent[]> {
  try {
    return await listEventsForward(from, opts);
  } catch (err) {
    if (!(err as { needFullRead?: boolean }).needFullRead) throw err;
    opts.onNote?.(`could not read forward by start time (${err instanceof Error ? err.message : String(err)}); reading ALL events instead`);
    return listEventsFull(from, to, opts);
  }
}

export const hcpApi: HcpApi = { listEmployees, listJobsInWindow, getJob, listAppointments, listEvents };
