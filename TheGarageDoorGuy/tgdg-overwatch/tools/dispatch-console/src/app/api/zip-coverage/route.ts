import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateDispatchAvailability } from "@/lib/availability";

const HORIZON_DAYS = 21;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const zip = searchParams.get("zip");
  if (!zip) {
    return NextResponse.json({ error: "zip is required" }, { status: 400 });
  }

  const coverage = await prisma.zipCoverage.findMany({
    where: { zip },
    include: { technician: true },
  });

  const technicians = coverage
    .filter((c: { technician: { active: boolean } }) => c.technician.active)
    .map((c: { technician: { id: string; name: string; active: boolean } }) => c.technician);

  if (technicians.length === 0) {
    return NextResponse.json({ zip, technicians: [], suggestedTechnicianId: null });
  }

  const now = new Date();
  const horizonEnd = new Date(now);
  horizonEnd.setDate(horizonEnd.getDate() + HORIZON_DAYS);

  // Auto-suggest: rank technicians by soonest opening (today > tomorrow > later).
  // TODO: N queries for N eligible techs — fine for a small roster per zip,
  // revisit with a single batched query if a zip ever covers many techs.
  let suggestedTechnicianId: string | null = null;
  let bestRank = Infinity;

  for (const tech of technicians) {
    const appointments = await prisma.appointment.findMany({
      where: {
        technicianId: tech.id,
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
    const avail = generateDispatchAvailability(now, busy);

    let rank = Infinity;
    if (avail.today.slots.length > 0) rank = 0;
    else if (avail.tomorrow.slots.length > 0) rank = 1;
    else if (avail.later.days.some((d) => d.slots.length > 0)) rank = 2;

    if (rank < bestRank) {
      bestRank = rank;
      suggestedTechnicianId = tech.id;
    }
  }

  return NextResponse.json({
    zip,
    technicians: technicians.map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })),
    suggestedTechnicianId,
  });
}
