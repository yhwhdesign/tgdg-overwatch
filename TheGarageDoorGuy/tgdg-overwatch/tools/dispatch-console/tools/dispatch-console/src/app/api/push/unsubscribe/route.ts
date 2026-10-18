import { NextResponse, type NextRequest } from "next/server";
import { validTopic } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// A phone turning alerts off from its setup page. Body: { code: string, endpoint: string }
// It answers the same whether or not anything was removed, so it cannot be used to probe for codes.
export async function POST(request: NextRequest) {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Send JSON." }, { status: 415, headers: { "cache-control": "no-store" } });
  }
  let body: { code?: unknown; endpoint?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  if (body && validTopic(body.code) && typeof body.endpoint === "string" && body.endpoint.length <= 700) {
    const person = await prisma.notifyRecipient.findUnique({ where: { topic: body.code } });
    if (person) await prisma.pushSubscription.deleteMany({ where: { recipientId: person.id, endpoint: body.endpoint } });
  }
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
