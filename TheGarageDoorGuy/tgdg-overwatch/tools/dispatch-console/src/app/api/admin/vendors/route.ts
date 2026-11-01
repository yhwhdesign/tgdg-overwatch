import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminGate } from "@/lib/admin-auth";
import { parseVendorInput } from "@/lib/orders";

export const dynamic = "force-dynamic";

const isDuplicate = (err: unknown) => typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";

// GET: the vendor list (Admin only).
export async function GET(request: NextRequest) {
  const denied = adminGate(request);
  if (denied) return denied;
  const vendors = await prisma.vendor.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ vendors }, { headers: { "cache-control": "no-store" } });
}

// POST: add a vendor. Names are unique. Passwords are never accepted.
export async function POST(request: NextRequest) {
  const denied = adminGate(request);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  const parsed = parseVendorInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const vendor = await prisma.vendor.create({ data: parsed.value });
    return NextResponse.json({ vendor }, { status: 201 });
  } catch (err) {
    if (isDuplicate(err)) return NextResponse.json({ error: "A vendor with that name already exists." }, { status: 409 });
    throw err;
  }
}
