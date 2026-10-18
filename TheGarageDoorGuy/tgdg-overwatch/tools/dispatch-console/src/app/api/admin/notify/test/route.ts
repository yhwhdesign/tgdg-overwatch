import { NextResponse, type NextRequest } from "next/server";
import { adminGate } from "@/lib/admin-auth";
import { ntfySender, TEST_MESSAGE, validTopic } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Body: { id: string } -> sends one test notification to that person's phone.
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
  try {
    await ntfySender().send({ topic: row.topic, name: row.name }, TEST_MESSAGE);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[notify-test] ${err instanceof Error ? err.message.slice(0, 160) : "unknown"}`);
    return NextResponse.json({ ok: false, error: "The notification service could not be reached. Check the server's internet connection and try again." }, { status: 502 });
  }
}
