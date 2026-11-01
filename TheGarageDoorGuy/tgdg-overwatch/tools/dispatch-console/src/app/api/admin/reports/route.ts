import { NextResponse, type NextRequest } from "next/server";
import { adminGate } from "@/lib/admin-auth";
import { RANGE_KEYS, type RangeKey } from "@/lib/reports";
import { getLiveReport } from "@/lib/reports-live";
import { describeSyncError } from "@/lib/sync-status";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET ?range=7|30|90|ytd|last-month[&fresh=1]  (Admin only)
// How the company and each tech are doing, read from Housecall Pro (read-only, cached ten minutes).
export async function GET(request: NextRequest) {
  const denied = adminGate(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const range = (params.get("range") ?? "30") as RangeKey;
  if (!RANGE_KEYS.includes(range)) return NextResponse.json({ error: `range must be one of: ${RANGE_KEYS.join(", ")}` }, { status: 400 });
  try {
    const report = await getLiveReport(range, params.get("fresh") === "1");
    return NextResponse.json({ ok: true, checkedAt: new Date().toISOString(), report }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const described = describeSyncError(err);
    console.error(`[reports] read failed: ${described.detail}`);
    const notConnected = err instanceof Error && /HCP_API_KEY is not set/.test(err.message);
    return NextResponse.json(
      { ok: false, error: notConnected ? "Housecall Pro is not connected yet (HCP_API_KEY is empty)." : `Could not read Housecall Pro: ${described.category}.` },
      { status: 502, headers: { "cache-control": "no-store" } }
    );
  }
}
