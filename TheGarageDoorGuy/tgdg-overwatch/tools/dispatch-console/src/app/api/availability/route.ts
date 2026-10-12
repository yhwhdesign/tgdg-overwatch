import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  SELECTABLE_DAYS_AHEAD,
  bestFit,
  generateDayAvailability,
  generateDispatchAvailability,
  selectableRange,
} from "@/lib/availability";
import { ZIP_CENTROIDS } from "@/data/ar-zip-centroids";
import { makeProximity } from "@/lib/zip-distance";

const DAY_MS = 24 * 60 * 60 * 1000;
const proximity = makeProximity(ZIP_CENTROIDS);

// GET ?technicianId=...&zip=72201               -> the default view: today, tomorrow, days 3-7
// GET ?technicianId=...&zip=72201&date=YYYY-MM-DD -> one specific day, on request
// `zip` is the customer's zip. With it, every open gap is scored by how near the calls on
// either side are, and the response includes the best fit. Without it, gaps are just "open".
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const technicianId = searchParams.get("technicianId");
  if (!technicianId) {
    return NextResponse.json({ error: "technicianId is required" }, { status: 400 });
  }

  const zip = searchParams.get("zip");
  if (zip !== null && !/^\d{5}$/.test(zip)) {
    return NextResponse.json({ error: "zip must be a 5-digit zip code" }, { status: 400 });
  }
  const fit = zip ? { customerZip: zip, proximity } : undefined;

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
  const appointments = await prisma.appointment.findMany({
    where: {
      technicianId,
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
