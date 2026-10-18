import { NextResponse, type NextRequest } from "next/server";
import { passwordMatches } from "@/lib/admin-session";
import { isWithinHours, readAutoSyncConfig } from "@/lib/auto-sync-controller";
import { itemsFromWatch, runNotify } from "@/lib/notify";
import { databasePushStore, databaseStore } from "@/lib/notify-store";
import { pushConfig, pushSender } from "@/lib/push";
import { getAllWatch } from "@/lib/watch-all";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Sends the phone notifications. A free outside scheduler (cron-job.org) calls this every 2 minutes with the header
//   Authorization: Bearer <CRON_SECRET>      (the same secret as the scheduled refresh)
// It only works inside the business refresh hours (AUTO_SYNC_HOURS), so the free database can sleep overnight.
// It reads the same answer the panel's alert bars use, and tells each person on the list about each event once.
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Scheduled notifications are off. Set CRON_SECRET on the server." }, { status: 503 });
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !passwordMatches(token, secret)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });

  const config = pushConfig();
  if (!config) return NextResponse.json({ error: "Phone alerts are not set up. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY on the server." }, { status: 503 });

  if (!isWithinHours(new Date(), readAutoSyncConfig(process.env))) {
    return NextResponse.json({ ok: true, skipped: "outside the business hours" });
  }
  try {
    const watch = await getAllWatch();
    if (!watch.ok) return NextResponse.json({ ok: true, skipped: "Job Watch could not read Housecall Pro this time" });
    const result = await runNotify({ items: itemsFromWatch(watch), store: databaseStore, sender: pushSender({ store: databasePushStore, config }), log: (m) => console.error(m) });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error(`[cron-notify] ${err instanceof Error ? err.message.slice(0, 200) : "unknown"}`);
    return NextResponse.json({ error: "The notification run failed." }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
