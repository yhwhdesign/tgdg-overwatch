import { NextResponse, type NextRequest } from "next/server";
import { validTopic } from "@/lib/notify";
import { saveSubscription } from "@/lib/notify-store";
import { prisma } from "@/lib/prisma";
import { pushConfig, sendToSubscription, validSubscription, WELCOME_MESSAGE } from "@/lib/push";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const BAD_LINK = "This setup link is not valid. Ask for a new one.";

// A phone turning alerts on from its setup page. This path is public (the phone has no console sign-in); what protects it
// is the join code: long, random, and the same secret that is in the person's link.
// Body: { code: string, subscription: { endpoint, keys: { p256dh, auth } } }
export async function POST(request: NextRequest) {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Send JSON." }, { status: 415, headers: NO_STORE });
  }
  const text = await request.text();
  if (text.length > 4096) return NextResponse.json({ error: "Too large." }, { status: 413, headers: NO_STORE });
  let body: { code?: unknown; subscription?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400, headers: NO_STORE });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Send JSON." }, { status: 400, headers: NO_STORE });
  if (!validTopic(body.code)) return NextResponse.json({ error: BAD_LINK }, { status: 404, headers: NO_STORE });
  const config = pushConfig();
  if (!config) return NextResponse.json({ error: "Phone alerts are not set up yet." }, { status: 503, headers: NO_STORE });
  const sub = validSubscription(body.subscription);
  if (!sub) return NextResponse.json({ error: "This phone's alert address was not accepted." }, { status: 400, headers: NO_STORE });
  const person = await prisma.notifyRecipient.findUnique({ where: { topic: body.code } });
  if (!person) return NextResponse.json({ error: BAD_LINK }, { status: 404, headers: NO_STORE });
  const devices = await saveSubscription(person.id, sub);
  // A first message so the person sees it work. Failing to send it does not undo the sign-up.
  await sendToSubscription(config, sub, WELCOME_MESSAGE(person.name)).catch(() => {});
  return NextResponse.json({ ok: true, devices }, { headers: NO_STORE });
}
