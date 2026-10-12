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
import { isOfferedFor, parseCallType, type CallType } from "@/lib/service-techs";
import { ZIP_CENTROIDS } from "@/data/ar-zip-centroids";
import { makeProximity } from "@/lib/zip-distance";

// Ranking only needs the default view (today through day 7), plus a day of slack.
const HORIZON_DAYS = VIEW_DAYS + 1;
const proximity = makeProximity(ZIP_CENTROIDS);

// Which classifications can take each kind of call.
const CLASSIFIED_FOR: Record<CallType, string[]> = {
  residential: ["residential", "hybrid"],
  commercial: ["commercial", "hybrid"],
};

interface TechRow {
  id: string;
  name: string;
  classification: string | null;
}

// GET ?zip=72201&type=residential|commercial
// Every technician marked on the Admin screen for that kind of call (residential or hybrid
// for a residential call, commercial or hybrid for a commercial one), in ANY zip: zip codes
// never limit who is offered. The zip is used only to find open time next to nearby calls.
// Each technician comes with their best opening for THIS customer: a gap between two calls
// near the customer's zip beats a gap next to one, which beats plain open time. They are
// listed best fit first, and the first one with any opening is marked as suggested.
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

  const rows: TechRow[] = await prisma.technician.findMany({
    where: { classification: { in: CLASSIFIED_FOR[type] } },
    select: { id: true, name: true, classification: true },
  });
  const technicians = rows.filter((t) => isOfferedFor(t.classification, type));

  if (technicians.length === 0) {
    return NextResponse.json({
      zip,
      type,
      timeZone: businessTimeZone(),
      technicians: [],
      suggestedTechnicianId: null,
      reason: "none-for-type",
    });
  }

  const now = new Date();
  const horizonEnd = new Date(now);
  horizonEnd.setDate(horizonEnd.getDate() + HORIZON_DAYS);

  // TODO: N queries for N technicians: fine for a small roster,
  // revisit with a single batched query if the roster ever grows a lot.
  const scored: { tech: TechRow; best: BestFit | null; soonest: SoonestOpening | null }[] = [];
  for (const tech of technicians) {
    const appointments = await prisma.appointment.findMany({
      where: {
        technicianId: tech.id,
        status: { not: "cancelled" },
        startTime: { lt: horizonEnd },
        endTime: { gt: now },
      },
      select: { startTime: true, endTime: true, zip: true, kind: true, label: true },
    });
    const busy = appointments.map((a: { startTime: Date; endTime: Date; zip: string | null; kind: string; label: string | null }) => ({
      start: a.startTime,
      end: a.endTime,
      zip: a.zip,
      kind: a.kind === "event" ? ("event" as const) : ("job" as const),
      label: a.label,
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
