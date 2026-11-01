import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  SELECTABLE_DAYS_AHEAD,
  bestFit,
  calendarDayBounds,
  generateDayAvailability,
  generateDispatchAvailability,
  selectableRange,
} from "@/lib/availability";
import { ZIP_CENTROIDS } from "@/data/ar-zip-centroids";
import { makeProximity } from "@/lib/zip-distance";
import { fitFor, readCustomerLocation } from "@/lib/customer-location";

const DAY_MS = 24 * 60 * 60 * 1000;
const proximity = makeProximity(ZIP_CENTROIDS);

// GET ?technicianId=...&lat=34.74&lng=-92.28&zip=72201               -> the default view: today, tomorrow, days 3-7
// GET ?technicianId=...&lat=34.74&lng=-92.28&zip=72201&date=YYYY-MM-DD -> one specific day, on request
// lat/lng are the customer's address (from /api/geocode); zip alone also works. With a location,
// every open gap is scored by how far it pulls the technician off his route for that day (see
// lib/availability.ts), and the response includes the best fit. Without one, gaps are just "open".
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const technicianId = searchParams.get("technicianId");
  if (!technicianId) {
    return NextResponse.json({ error: "technicianId is required" }, { status: 400 });
  }

  const location = readCustomerLocation(searchParams, false);
  if (!location.ok) return NextResponse.json({ error: location.error }, { status: 400 });
  const fit = fitFor(location, proximity);

  const now = new Date();
  const date = searchParams.get("date");

  // Validate before touching the database. Days beyond what the HCP sync mirrors
  // have no data here, so we refuse rather than show them as falsely wide open.
  if (date !== null) {
    const range = selectableRange(now);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < range.min || date > range.max) {
      return NextResponse.json(
        {
          error:
            `Pick a day between ${range.min} and ${range.max}. ` +
            "Days further out aren't mirrored from Housecall Pro, so check HCP directly for those.",
        },
        { status: 400 }
      );
    }
  }

  const horizonEnd = new Date(now.getTime() + (SELECTABLE_DAYS_AHEAD + 1) * DAY_MS);
  // From midnight today, not from now: a job he already finished this morning still tells us
  // where he is, which the route scoring needs.
  const startOfToday = calendarDayBounds(selectableRange(now).min).start;
  const appointments = await prisma.appointment.findMany({
    where: {
      technicianId,
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

  if (date !== null) {
    try {
      return NextResponse.json({ technicianId, ...generateDayAvailability(now, busy, date, fit) });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "bad date" }, { status: 400 });
    }
  }

  const availability = generateDispatchAvailability(now, busy, fit);
  return NextResponse.json({ technicianId, ...availability, bestFit: bestFit(availability) });
}
