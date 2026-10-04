import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateDispatchAvailability } from "@/lib/availability";

const HORIZON_DAYS = 21; // matches availability.ts's LATER_TIER_MAX_END_DAY

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const technicianId = searchParams.get("technicianId");
  if (!technicianId) {
    return NextResponse.json({ error: "technicianId is required" }, { status: 400 });
  }

  const now = new Date();
  const horizonEnd = new Date(now);
  horizonEnd.setDate(horizonEnd.getDate() + HORIZON_DAYS);

  const appointments = await prisma.appointment.findMany({
    where: {
      technicianId,
      status: { not: "cancelled" },
      startTime: { lt: horizonEnd },
      endTime: { gt: now },
    },
    select: { startTime: true, endTime: true },
  });

  const busy = appointments.map((a: { startTime: Date; endTime: Date }) => ({
    start: a.startTime,
    end: a.endTime,
  }));
  const availability = generateDispatchAvailability(now, busy);

  return NextResponse.json({ technicianId, ...availability });
}
