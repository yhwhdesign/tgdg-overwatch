import { NextResponse } from "next/server";
import { businessTimeZone } from "@/lib/availability";
import { getEstimateWatch } from "@/lib/estimates";
import { estimateApi } from "@/lib/hcp-client";
import { getJobWatch } from "@/lib/job-watch";
import { hcpApi, liveWatchHelpers } from "@/lib/job-watch-live";

export const dynamic = "force-dynamic";

// Who is on a job longer than normal, for the desktop panel's alert bar. Like the other status routes it is plain
// information for console users: technician first/last names, a job type and number, and times. NEVER anything
// about a customer. It always answers 200: a failure is `{ ok: false, error }` in the body, so the panel can show
// "Job Watch is offline" instead of mistaking an error for "nothing to report". Cached for a minute, so any
// number of open panels cost one request a minute to Housecall Pro.
//
// Estimates ride along: a tech finishing an estimate in the field (a "finished" bar listing the options and amounts)
// and an office-made estimate nobody has answered for a few days (a "waiting" bar). If the estimates cannot be read,
// the job bars still work and `estimatesOk` is false.
export async function GET() {
  const result = await getJobWatch({ api: hcpApi, helpers: liveWatchHelpers });
  if (!result.ok) return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  try {
    const est = await getEstimateWatch({ api: estimateApi, timeZone: businessTimeZone });
    const completed = [...est.finished, ...result.completed].sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt)).slice(0, 20);
    return NextResponse.json({ ...result, alerts: [...result.alerts, ...est.waiting], completed, estimatesOk: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error(`[job-watch] estimates could not be read: ${err instanceof Error ? err.message.slice(0, 200) : "unknown"}`);
    return NextResponse.json({ ...result, estimatesOk: false }, { headers: { "Cache-Control": "no-store" } });
  }
}
