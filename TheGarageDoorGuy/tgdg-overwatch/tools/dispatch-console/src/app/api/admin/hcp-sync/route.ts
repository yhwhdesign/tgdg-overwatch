import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runFullSync, SyncBusyError } from "@/lib/run-sync";

export const dynamic = "force-dynamic";

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Pulls real technicians and upcoming jobs from Housecall Pro into our tables.
// DRY RUN BY DEFAULT: pass ?dryRun=0 to actually write. Protected by the
// ADMIN_SYNC_SECRET env var (the route is disabled if that isn't set).
// Use scripts/hcp-sync.mjs rather than calling this by hand.
export async function POST(request: NextRequest) {
  const expected = process.env.ADMIN_SYNC_SECRET;
  if (!expected) return NextResponse.json({ error: "not enabled" }, { status: 404 });
  if (!secretMatches(request.headers.get("x-admin-secret") ?? "", expected)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const dryRun = params.get("dryRun") !== "0";
  const retireDemo = params.get("retireDemo") === "1";

  try {
    const result = await runFullSync({ dryRun, retireDemo, trigger: "manual", log: (message) => console.log(message) });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SyncBusyError) return NextResponse.json({ error: "A refresh is already running. Try again in a moment." }, { status: 409 });
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
