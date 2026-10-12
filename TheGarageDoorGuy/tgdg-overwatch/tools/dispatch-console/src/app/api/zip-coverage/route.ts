import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  VIEW_DAYS,
  bestFit,
  businessTimeZone,
  compareBestFit,
  generateDispatchAvailability,
  soonestOpening,
  type BestFit,
  type SoonestOpening,
} from "@/lib/availability";
import { isOfferedFor, parseCallType } from "@/lib/service-techs";
import { ZIP_CENTROIDS } from "@/data/ar-zip-centroids";
import { makeProximity } from "@/lib/zip-distance";

// Ranking only needs the default view (today through day 7), plus a day of slack.
const HORIZON_DAYS = VIEW_DAYS + 1;
const proximity = makeProximity(ZIP_CENTROIDS);

interface TechRow {
  id: string;
  name: string;
  classification: string | null;
}

// GET ?zip=72201&type=residential|commercial
// Technicians who cover the zip AND are classified for that kind of call on the
// Admin screen (residential, commercial, or hybrid). Each comes with their best opening
// for THIS customer: a gap between two calls near the customer's zip beats a gap next to
// one, which beats plain open time. They are listed best fit first, and the first one with
// any opening is marked as suggested. Anyone not classified is never offered.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const zip = searchParams.get("zip");
  if (!zip || !/^\d{5}$/.test(zip)) {
    return NextResponse.json({ error: "zip must be a 5-digit zip code" }, { status: 400 });
  }
  const type = parseCallType(searchParams.get("type"));
  if (!type) {
    return NextResponse.json({ error: 'type must be "residential" or "commercial"' }, { status: 400 });
  }

  const coverage = await prisma.zipCoverage.findMany({
    where: { zip },
    include: { technician: true },
  });

  const covering: TechRow[] = coverage.map((c: { technician: TechRow }) => c.technician);
  const technicians = covering.filter((t) => isOfferedFor(t.classification, type));

  if (technicians.length === 0) {
    // Tell the screen WHY it is empty so the message can be accurate.
    const reason = covering.length === 0 ? "no-coverage" : "none-for-type";
    return NextResponse.json({
      zip,
      type,
      timeZone: businessTimeZone(),
      technicians: [],
      suggestedTechnicianId: null,
      reason,
    });
  }

  const now = new Date();
  const horizonEnd = new Date(now);
  horizonEnd.setDate(horizonEnd.getDate() + HORIZON_DAYS);

  // TODO: N queries for N eligible techs: fine for a small roster per zip,
  // revisit with a single batched query if a zip ever covers many techs.
  const scored: { tech: TechRow; best: BestFit | null; soonest: SoonestOpening | null }[] = [];
  for (const tech of technicians) {
    const appointments = await prisma.appointment.findMany({
      where: {
        technicianId: tech.id,
        status: { not: "cancelled" },
        startTime: { lt: horizonEnd },
        endTime: { gt: now },
      },
      select: { startTime: true, endTime: true, zip: true },
    });
    const busy = appointments.map((a: { startTime: Date; endTime: Date; zip: string | null }) => ({
      start: a.startTime,
      end: a.endTime,
      zip: a.zip,
    }));
    const avail = generateDispatchAvailability(now, busy, { customerZip: zip, proximity });
    scored.push({ tech, best: bestFit(avail), soonest: soonestOpening(avail) });
  }

  scored.sort((a, b) => compareBestFit(a.best, b.best) || a.tech.name.localeCompare(b.tech.name));

  return NextResponse.json({
    zip,
    type,
    timeZone: businessTimeZone(),
    technicians: scored.map(({ tech, best, soonest }) => ({
      id: tech.id,
      name: tech.name,
      bestFit: best,
      soonest,
    })),
    suggestedTechnicianId: scored[0].best ? scored[0].tech.id : null,
    reason: null,
  });
}
