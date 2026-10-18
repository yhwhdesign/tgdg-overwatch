import { businessTimeZone } from "@/lib/availability";
import { getEstimateWatch } from "@/lib/estimates";
import { estimateApi } from "@/lib/hcp-client";
import { getJobWatch, type JobWatchResult } from "@/lib/job-watch";
import { hcpApi, liveWatchHelpers } from "@/lib/job-watch-live";

// Job Watch plus the estimate watch, merged into the one answer the panel and the phone notifications both use.
// If the estimates cannot be read, the job part still works and `estimatesOk` is false.
export type AllWatchResult = JobWatchResult | (Extract<JobWatchResult, { ok: true }> & { estimatesOk: boolean });

export async function getAllWatch(): Promise<AllWatchResult> {
  const result = await getJobWatch({ api: hcpApi, helpers: liveWatchHelpers });
  if (!result.ok) return result;
  try {
    const est = await getEstimateWatch({ api: estimateApi, timeZone: businessTimeZone });
    const completed = [...est.finished, ...result.completed].sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt)).slice(0, 20);
    return { ...result, alerts: [...result.alerts, ...est.waiting], completed, estimatesOk: true } as AllWatchResult;
  } catch (err) {
    console.error(`[job-watch] estimates could not be read: ${err instanceof Error ? err.message.slice(0, 200) : "unknown"}`);
    return { ...result, estimatesOk: false };
  }
}
