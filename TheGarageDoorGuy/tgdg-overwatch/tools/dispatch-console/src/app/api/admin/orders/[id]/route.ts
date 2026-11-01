import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminGate } from "@/lib/admin-auth";
import { businessTimeZone } from "@/lib/availability";
import { fillStatusDates, parseOrderInput, todayIn } from "@/lib/orders";

export const dynamic = "force-dynamic";

const INCLUDE = { vendor: { select: { id: true, name: true, portalUrl: true, website: true } } };
const isMissing = (err: unknown) => typeof err === "object" && err !== null && (err as { code?: string }).code === "P2025";

// PUT: replace an order with what the form sends (the whole order, so the form and the database never drift).
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = adminGate(request);
  if (denied) return denied;
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  const parsed = parseOrderInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const data = fillStatusDates(parsed.value, todayIn(businessTimeZone()));
  if (data.vendorId && !(await prisma.vendor.findUnique({ where: { id: data.vendorId } }))) {
    return NextResponse.json({ error: "That vendor no longer exists." }, { status: 400 });
  }
  try {
    const order = await prisma.order.update({ where: { id }, data, include: INCLUDE });
    return NextResponse.json({ order });
  } catch (err) {
    if (isMissing(err)) return NextResponse.json({ error: "No such order." }, { status: 404 });
    throw err;
  }
}

// DELETE: remove an order for good (use "cancelled" to keep a record instead).
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = adminGate(request);
  if (denied) return denied;
  const { id } = await context.params;
  const { count } = await prisma.order.deleteMany({ where: { id } });
  if (count === 0) return NextResponse.json({ error: "No such order." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
