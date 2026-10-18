import { NextResponse } from "next/server";
import { businessTimeZone } from "@/lib/availability";
import { getEstimateReport } from "@/lib/estimates";
import { estimateApi } from "@/lib/hcp-client";
import { describeSyncError } from "@/lib/sync-status";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The Estimates page: this year's estimates carrying the list tags (default "Jasen Est" and "*") plus close-rate
// numbers by month and by tech. Behind the console sign-in like every other console page. Read-only against Housecall
// Pro, cached for ten minutes (`?fresh=1` skips the cache). Customer names are only included when ESTIMATE_SHOW_CUSTOMER=on.
export async function GET(request: Request) {
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  try {
    const report = await getEstimateReport({ api: estimateApi, timeZone: businessTimeZone, fresh });
    return NextResponse.json({ ok: true, checkedAt: new Date().toISOString(), report }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const described = describeSyncError(err);
    console.error(`[estimates] read failed: ${described.detail}`);
    const notConnected = err instanceof Error && /HCP_API_KEY is not set/.test(err.message);
    return NextResponse.json({ ok: false, error: notConnected ? "Housecall Pro is not connected yet (HCP_API_KEY is empty)." : `Could not read estimates: ${described.category}.` }, { headers: { "Cache-Control": "no-store" } });
  }
}
