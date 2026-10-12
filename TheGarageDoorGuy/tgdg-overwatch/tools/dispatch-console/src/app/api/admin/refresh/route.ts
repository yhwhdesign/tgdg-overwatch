import { NextResponse, type NextRequest } from "next/server";
import { adminGate } from "@/lib/admin-auth";
import { runFullSync, SyncBusyError } from "@/lib/run-sync";
import { describeSyncError } from "@/lib/sync-status";

export const dynamic = "force-dynamic";

// "Refresh now" from the Admin screen: the same refresh the timer does, started by hand.
// Needs the admin sign-in and a JSON request (see adminGate).
export async function POST(request: NextRequest) {
  const denied = adminGate(request);
  if (denied) return denied;

  const started = Date.now();
  try {
    const result = await runFullSync({ dryRun: false, trigger: "manual", log: (m) => console.log(m) });
    const events = result.events as { rows?: number; error?: string };
    return NextResponse.json({
      ok: true,
      seconds: Math.round((Date.now() - started) / 100) / 10,
      jobsRows: (result.jobs as { appointmentRows?: number }).appointmentRows ?? 0,
      eventsRows: events.rows ?? null,
      eventsError: events.error ? describeSyncError(new Error(events.error)).category : null,
      statusRecorded: result.statusRecorded,
    });
  } catch (err) {
    if (err instanceof SyncBusyError) return NextResponse.json({ error: "A refresh is already running. Try again in a moment." }, { status: 409 });
    const { category, detail } = describeSyncError(err);
    console.error(`[refresh] ${category}: ${detail}`);
    return NextResponse.json({ error: `The refresh failed: ${category}.` }, { status: 500 });
  }
}
