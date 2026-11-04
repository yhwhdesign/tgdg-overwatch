import { NextResponse } from "next/server";
import { businessTimeZone } from "@/lib/availability";
import { getEstimateReport, mergeReviews, type ReviewRecord } from "@/lib/estimates";
import { estimateApi } from "@/lib/hcp-client";
import { prisma } from "@/lib/prisma";
import { describeSyncError } from "@/lib/sync-status";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The Estimates page: this year's estimates carrying the list tags (default "Jasen Est" and "*") plus close-rate
// numbers by month and by tech. Behind the console sign-in like every other console page. Read-only against Housecall
// Pro, cached for ten minutes (`?fresh=1` skips the cache). Customer names are only included when ESTIMATE_SHOW_CUSTOMER=on.
//
// Dispatchers' reviews (marked reviewed / notes) live in OUR database and are merged in on every read, so a review
// shows at once without waiting for the Housecall Pro cache. Reviewing never writes to Housecall Pro.
export async function GET(request: Request) {
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  try {
    const report = await getEstimateReport({ api: estimateApi, timeZone: businessTimeZone, fresh });

    // Merge our own review marks. If the reviews table can't be read, the list still shows (everything as "needs review").
    let reviews: Record<string, ReviewRecord> = {};
    try {
      const rows = await prisma.estimateReview.findMany({ select: { estimateId: true, reviewedBy: true, reviewedAt: true, note: true, reviewedFingerprint: true } });
      reviews = Object.fromEntries(
        rows.map((r: { estimateId: string; reviewedBy: string; reviewedAt: Date; note: string | null; reviewedFingerprint: string }) => [
          r.estimateId,
          { reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt.toISOString(), note: r.note, reviewedFingerprint: r.reviewedFingerprint },
        ])
      );
    } catch (err) {
      console.error(`[estimates] reviews unavailable: ${describeSyncError(err).detail}`);
    }
    const merged = mergeReviews(report.list, reviews, businessTimeZone());

    return NextResponse.json(
      { ok: true, checkedAt: new Date().toISOString(), report: { ...report, list: merged.rows, needsReviewCount: merged.needsReviewCount } },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const described = describeSyncError(err);
    console.error(`[estimates] read failed: ${described.detail}`);
    const notConnected = err instanceof Error && /HCP_API_KEY is not set/.test(err.message);
    return NextResponse.json({ ok: false, error: notConnected ? "Housecall Pro is not connected yet (HCP_API_KEY is empty)." : `Could not read estimates: ${described.category}.` }, { headers: { "Cache-Control": "no-store" } });
  }
}
