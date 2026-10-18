import { NextResponse, type NextRequest } from "next/server";
import { adminGate } from "@/lib/admin-auth";
import { cleanName, KIND_LABEL, newTopic, NOTIFY_KINDS, parseKinds } from "@/lib/notify";
import { pushConfig } from "@/lib/push";
import { toRecipient } from "@/lib/notify-store";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// The people on the phone-notification list (Admin screen). Everything here is admin-only.
type ListRow = Parameters<typeof toRecipient>[0] & { _count?: { subscriptions: number } };
function shape(row: ListRow) {
  const r = toRecipient(row);
  // "topic" is the person's private join code: the secret in their setup link. "devices" is how many phones turned alerts on.
  return { id: r.id, name: r.name, topic: r.topic, kinds: r.kinds, enabled: r.enabled, devices: row._count?.subscriptions ?? 0 };
}

export async function GET(request: NextRequest) {
  const denied = adminGate(request);
  if (denied) return denied;
  const rows = await prisma.notifyRecipient.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { subscriptions: true } } } });
  return NextResponse.json({
    people: rows.map(shape),
    kinds: NOTIFY_KINDS.map((k) => ({ id: k, label: KIND_LABEL[k] })),
    pushReady: pushConfig() !== null,
    schedulerReady: Boolean(process.env.CRON_SECRET),
  });
}

async function readBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// Body: { name: string, kinds?: string[] }  -> a new person with their own private setup link.
export async function POST(request: NextRequest) {
  const denied = adminGate(request);
  if (denied) return denied;
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  const name = cleanName(body.name);
  if (!name) return NextResponse.json({ error: "Give the person a name (up to 60 characters)." }, { status: 400 });
  const kinds = body.kinds === undefined ? [] : parseKinds(body.kinds);
  if (!kinds) return NextResponse.json({ error: "kinds must be a list of known alert types." }, { status: 400 });
  const row = await prisma.notifyRecipient.create({ data: { name, topic: newTopic(), kinds, enabled: true } });
  return NextResponse.json({ person: shape(row) }, { status: 201 });
}

// Body: { id: string, name?: string, kinds?: string[], enabled?: boolean }
export async function PUT(request: NextRequest) {
  const denied = adminGate(request);
  if (denied) return denied;
  const body = await readBody(request);
  if (!body || typeof body.id !== "string" || !body.id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  const data: { name?: string; kinds?: string[]; enabled?: boolean } = {};
  if (body.name !== undefined) {
    const name = cleanName(body.name);
    if (!name) return NextResponse.json({ error: "Give the person a name (up to 60 characters)." }, { status: 400 });
    data.name = name;
  }
  if (body.kinds !== undefined) {
    const kinds = parseKinds(body.kinds);
    if (!kinds) return NextResponse.json({ error: "kinds must be a list of known alert types." }, { status: 400 });
    data.kinds = kinds;
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled must be true or false." }, { status: 400 });
    data.enabled = body.enabled;
  }
  try {
    const row = await prisma.notifyRecipient.update({ where: { id: body.id }, data });
    return NextResponse.json({ person: shape(row) });
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2025") return NextResponse.json({ error: "No such person." }, { status: 404 });
    throw err;
  }
}

// Body: { id: string }
export async function DELETE(request: NextRequest) {
  const denied = adminGate(request);
  if (denied) return denied;
  const body = await readBody(request);
  if (!body || typeof body.id !== "string" || !body.id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  const gone = await prisma.notifyRecipient.deleteMany({ where: { id: body.id } });
  return NextResponse.json({ ok: true, removed: gone.count });
}
