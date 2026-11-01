import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminGate } from "@/lib/admin-auth";
import { businessTimeZone } from "@/lib/availability";
import { fillStatusDates, parseOrderInput, sortOrders, summarize, todayIn } from "@/lib/orders";

export const dynamic = "force-dynamic";

// Order tracker (Admin only). Orders and vendors are typed in by hand; nothing here touches Housecall Pro.
const INCLUDE = { vendor: { select: { id: true, name: true, portalUrl: true, website: true } } };

// GET: every order (late first), the counts for the top of the page, and the vendor list for the form.
export async function GET(request: NextRequest) {
  const denied = adminGate(request);
  if (denied) return denied;
  const today = todayIn(businessTimeZone());
  const [orders, vendors] = await Promise.all([
    prisma.order.findMany({ include: INCLUDE, orderBy: { createdAt: "desc" }, take: 1000 }),
    prisma.vendor.findMany({ orderBy: { name: "asc" } }),
  ]);
  const sorted = sortOrders(orders as Parameters<typeof sortOrders>[0], today);
  return NextResponse.json({ today, orders: sorted, summary: summarize(sorted, today), vendors }, { headers: { "cache-control": "no-store" } });
}

// POST: add an order.
export async function POST(request: NextRequest) {
  const denied = adminGate(request);
  if (denied) return denied;
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
  const order = await prisma.order.create({ data, include: INCLUDE });
  return NextResponse.json({ order }, { status: 201 });
}
