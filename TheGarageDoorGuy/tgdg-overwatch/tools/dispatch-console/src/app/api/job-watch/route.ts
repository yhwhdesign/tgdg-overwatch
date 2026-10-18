import { NextResponse } from "next/server";
import { getAllWatch } from "@/lib/watch-all";

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
  return NextResponse.json(await getAllWatch(), { headers: { "Cache-Control": "no-store" } });
}
