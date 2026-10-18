import { NextResponse, type NextRequest } from "next/server";
import { adminGate } from "@/lib/admin-auth";
import { NoDeviceError, TEST_MESSAGE, validTopic } from "@/lib/notify";
import { databasePushStore } from "@/lib/notify-store";
import { pushConfig, pushSender } from "@/lib/push";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Body: { id: string } -> sends one test notification to that person's phone(s).
export async function POST(request: NextRequest) {
  const denied = adminGate(request);
  if (denied) return denied;
  let body: { id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  if (typeof body.id !== "string" || !body.id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  const row = await prisma.notifyRecipient.findUnique({ where: { id: body.id } });
  if (!row || !validTopic(row.topic)) return NextResponse.json({ error: "No such person." }, { status: 404 });
  const config = pushConfig();
  if (!config) return NextResponse.json({ error: "Phone alerts are not set up on the server yet (the VAPID keys are missing)." }, { status: 503 });
  try {
    await pushSender({ store: databasePushStore, config }).send({ id: row.id, name: row.name }, TEST_MESSAGE);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof NoDeviceError) {
      return NextResponse.json({ ok: false, error: `${row.name} has not turned on alerts on a phone yet. Open their setup link on the phone first.` }, { status: 409 });
    }
    console.error(`[notify-test] ${err instanceof Error ? err.message.slice(0, 160) : "unknown"}`);
    return NextResponse.json({ ok: false, error: "The phone could not be reached. Try again in a minute." }, { status: 502 });
  }
}
