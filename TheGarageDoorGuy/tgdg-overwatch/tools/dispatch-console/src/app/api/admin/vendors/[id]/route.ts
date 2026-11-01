import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminGate } from "@/lib/admin-auth";
import { parseVendorInput } from "@/lib/orders";

export const dynamic = "force-dynamic";

const code = (err: unknown) => (typeof err === "object" && err !== null ? (err as { code?: string }).code : undefined);

// PUT: replace a vendor's details.
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
  const parsed = parseVendorInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const vendor = await prisma.vendor.update({ where: { id }, data: parsed.value });
    return NextResponse.json({ vendor });
  } catch (err) {
    if (code(err) === "P2025") return NextResponse.json({ error: "No such vendor." }, { status: 404 });
    if (code(err) === "P2002") return NextResponse.json({ error: "A vendor with that name already exists." }, { status: 409 });
    throw err;
  }
}

// DELETE: remove a vendor. Its orders are kept (they just lose the vendor name), so history is never lost.
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = adminGate(request);
  if (denied) return denied;
  const { id } = await context.params;
  const { count } = await prisma.vendor.deleteMany({ where: { id } });
  if (count === 0) return NextResponse.json({ error: "No such vendor." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
