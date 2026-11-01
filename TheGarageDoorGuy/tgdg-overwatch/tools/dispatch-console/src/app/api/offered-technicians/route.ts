import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  VIEW_DAYS,
  bestFit,
  businessTimeZone,
  calendarDayBounds,
  selectableRange,
  compareBestFit,
  generateDispatchAvailability,
  soonestOpening,
  type BestFit,
  type SoonestOpening,
} from "@/lib/availability";
import { isOfferedFor, parseCallType, type CallType } from "@/lib/service-techs";
import { ZIP_CENTROIDS } from "@/data/ar-zip-centroids";
import { makeProximity } from "@/lib/zip-distance";
import { fitFor, readCustomerLocation } from "@/lib/customer-location";

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

// GET ?lat=34.74&lng=-92.28&zip=72201&type=residential|commercial   (lat/lng from /api/geocode; zip alone also works)
// Every technician marked on the Admin screen for that kind of call (residential or hybrid
// for a residential call, commercial or hybrid for a commercial one), anywhere: the location
// never limits who is offered. It is used only to keep technicians on their route.
// Each technician comes with their best opening for THIS customer, ranked (see lib/availability.ts):
//   1. on his route: <= 10 extra minutes of driving (between two jobs, or right before/after one)
//   2. an open day: nothing booked that day, so the customer becomes his first call
//   3. off his route: fewest extra minutes first
// They are listed best fit first, and the first one with any opening is marked as suggested.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const location = readCustomerLocation(searchParams, true);
  if (!location.ok) return NextResponse.json({ error: location.error }, { status: 400 });
  const zip = location.zip;
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
  // From midnight today: a job he already finished this morning still tells us where he is.
  const startOfToday = calendarDayBounds(selectableRange(now).min).start;
  const fit = fitFor(location, proximity);

  // TODO: N queries for N technicians: fine for a small roster,
  // revisit with a single batched query if the roster ever grows a lot.
  const scored: { tech: TechRow; best: BestFit | null; soonest: SoonestOpening | null }[] = [];
  for (const tech of technicians) {
    const appointments = await prisma.appointment.findMany({
      where: {
        technicianId: tech.id,
        status: { not: "cancelled" },
        startTime: { lt: horizonEnd },
        endTime: { gt: startOfToday },
      },
      select: { startTime: true, endTime: true, zip: true, lat: true, lng: true, kind: true, label: true },
    });
    type Row = { startTime: Date; endTime: Date; zip: string | null; lat?: number | null; lng?: number | null; kind: string; label: string | null };
    const busy = appointments.map((a: Row) => ({
      start: a.startTime,
      end: a.endTime,
      zip: a.zip,
      lat: a.lat ?? null,
      lng: a.lng ?? null,
      kind: a.kind === "event" ? ("event" as const) : ("job" as const),
      label: a.label,
    }));
    const avail = generateDispatchAvailability(now, busy, fit);
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
