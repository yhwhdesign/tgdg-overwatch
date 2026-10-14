import { NextResponse } from "next/server";
import { getJobWatch } from "@/lib/job-watch";
import { hcpApi, liveWatchHelpers } from "@/lib/job-watch-live";

export const dynamic = "force-dynamic";

// Who is on a job longer than normal, for the desktop panel's alert bar. Like the other status routes it is plain
// information for console users: technician first/last names, a job type and number, and times. NEVER anything
// about a customer. It always answers 200: a failure is `{ ok: false, error }` in the body, so the panel can show
// "Job Watch is offline" instead of mistaking an error for "nothing to report". Cached for a minute, so any
// number of open panels cost one request a minute to Housecall Pro.
export async function GET() {
  const result = await getJobWatch({ api: hcpApi, helpers: liveWatchHelpers });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
