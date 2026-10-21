import { NextResponse } from "next/server";
import { getLiveWeekendRecap } from "@/lib/weekend-recap-live";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The Weekend recap page: the jobs worked from Friday 6 PM to Sunday 10 PM with the techs' notes, the ones that
// look like they need the office listed first. Behind the console sign-in like every other console page. Read-only
// against Housecall Pro, cached for five minutes (`?fresh=1` skips the cache). `?back=1` is the weekend before, up
// to 8. Notes can hold customer details (a gate code, a phone number), so JOB_WATCH_SHOW_NOTES=off hides them here
// too. It always answers 200: a failure is `{ ok: false, error }` in the body.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const back = Number(params.get("back") ?? "0");
  return NextResponse.json(await getLiveWeekendRecap(Number.isInteger(back) ? back : 0, params.get("fresh") === "1"), { headers: { "Cache-Control": "no-store" } });
}
