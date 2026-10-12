import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminGate } from "@/lib/admin-auth";
import { parseClassification } from "@/lib/service-techs";

export const dynamic = "force-dynamic";

const SELECT = { id: true, name: true, hcpRole: true, classification: true };

// The technicians we got from Housecall Pro, for the Admin screen.
export async function GET(request: NextRequest) {
  const denied = adminGate(request);
  if (denied) return denied;

  const technicians = await prisma.technician.findMany({
    // the seeded demo person is a test artifact, not someone to classify
    where: { NOT: { hcpEmployeeId: "demo-tech-1" } },
    select: SELECT,
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ technicians });
}

// Body: { id: string, classification: "residential" | "commercial" | "hybrid" | null }
// null means "not offered".
export async function PUT(request: NextRequest) {
  const denied = adminGate(request);
  if (denied) return denied;

  let body: { id?: unknown; classification?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  if (typeof body.id !== "string" || body.id === "") {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  const classification = parseClassification(body.classification);
  if (body.classification !== null && classification === null) {
    return NextResponse.json(
      { error: 'classification must be "residential", "commercial", "hybrid", or null.' },
      { status: 400 }
    );
  }

  try {
    const technician = await prisma.technician.update({
      where: { id: body.id },
      data: { classification },
      select: SELECT,
    });
    return NextResponse.json({ technician });
  } catch (err) {
    // Prisma's "record not found" error
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2025") {
      return NextResponse.json({ error: "No such technician." }, { status: 404 });
    }
    throw err;
  }
}
