import { businessTimeZone, calendarDayBounds } from "./availability";
import { readEstimatesSince } from "./estimates";
import { estimateApi } from "./hcp-client";
import type { HcpJob } from "./hcp-sync";
import { classifyJob, employeeNames, readWatchRules } from "./job-watch";
import { hcpApi, liveWatchHelpers } from "./job-watch-live";
import { buildReport, rangeFor, type RangeKey, type REstimate, type Report, type RJob } from "./reports";
import { todayIn } from "./orders";

// Reports, connected to Housecall Pro. READ-ONLY: only list calls (jobs, estimates, employees). Cached for ten
// minutes per range (`fresh` skips the cache), because a year of jobs is many pages.

const PAGE_SIZE = 100;
const MAX_JOB_PAGES = 80; // up to 8,000 jobs per period
const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; report: Report }>();

async function jobsBetween(from: string, to: string): Promise<RJob[]> {
  const start = calendarDayBounds(from).start;
  const end = calendarDayBounds(to).end;
  const out: RJob[] = [];
  let pages = 0;
  for await (const page of hcpApi.listJobsInWindow(start, end, { pageSize: PAGE_SIZE })) {
    out.push(...(page.jobs as unknown as RJob[]));
    if (++pages >= MAX_JOB_PAGES) break;
  }
  return out;
}

function estimatesBetween(all: REstimate[], from: string, to: string, timeZone: string): REstimate[] {
  return all.filter((e) => {
    const t = e.created_at ? Date.parse(e.created_at) : NaN;
    if (!Number.isFinite(t)) return false;
    const day = todayIn(timeZone, new Date(t));
    return day >= from && day <= to;
  });
}

export async function getLiveReport(key: RangeKey, fresh = false): Promise<Report> {
  const now = new Date();
  const hit = cache.get(key);
  if (!fresh && hit && now.getTime() - hit.at < TTL_MS) return hit.report;

  const timeZone = businessTimeZone();
  const today = todayIn(timeZone, now);
  const range = rangeFor(key, today);
  const earliest = range.previous ? range.previous.from : range.from;
  const watch = readWatchRules();

  const [jobs, previousJobs, allEstimates, names] = await Promise.all([
    jobsBetween(range.from, range.to),
    range.previous ? jobsBetween(range.previous.from, range.previous.to) : Promise.resolve(null),
    readEstimatesSince(estimateApi, earliest, timeZone) as Promise<REstimate[]>,
    employeeNames(hcpApi, now, liveWatchHelpers),
  ]);

  const report = buildReport({
    jobs,
    previousJobs,
    estimates: estimatesBetween(allEstimates, range.from, range.to, timeZone),
    previousEstimates: range.previous ? estimatesBetween(allEstimates, range.previous.from, range.previous.to, timeZone) : null,
    names,
    classify: (job) => classifyJob(job as unknown as HcpJob, watch.installWords),
    range: { from: range.from, to: range.to, label: range.label, previousLabel: range.previous?.label ?? null },
    timeZone,
  });
  cache.set(key, { at: now.getTime(), report });
  return report;
}
