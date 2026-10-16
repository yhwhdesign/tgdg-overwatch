import { NextResponse, type NextRequest } from "next/server";
import { passwordMatches } from "@/lib/admin-session";
import { isWithinHours, readAutoSyncConfig } from "@/lib/auto-sync-controller";
import { runFullSync, SyncBusyError } from "@/lib/run-sync";
import { describeSyncError } from "@/lib/sync-status";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds; a normal refresh takes under 10

// The scheduled refresh for hosting that can't keep a timer running. A free outside scheduler (or Vercel Cron
// on a paid plan) calls this every 10 minutes with the header   Authorization: Bearer <CRON_SECRET>.
// It only refreshes inside the business refresh hours (AUTO_SYNC_HOURS), so the free database can sleep overnight.
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "The scheduled refresh is off. Set CRON_SECRET on the server." }, { status: 503 });
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !passwordMatches(token, secret)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });

  const config = readAutoSyncConfig(process.env);
  if (!isWithinHours(new Date(), config)) {
    return NextResponse.json({ ok: true, skipped: "outside the refresh hours" });
  }
  const started = Date.now();
  try {
    await runFullSync({ dryRun: false, trigger: "auto", log: (m) => console.log(m) });
    return NextResponse.json({ ok: true, seconds: Math.round((Date.now() - started) / 100) / 10 });
  } catch (err) {
    if (err instanceof SyncBusyError) return NextResponse.json({ ok: true, skipped: "a refresh is already running" });
    const { category, detail } = describeSyncError(err);
    console.error(`[cron-sync] ${category}: ${detail}`);
    return NextResponse.json({ error: `The refresh failed: ${category}.` }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
