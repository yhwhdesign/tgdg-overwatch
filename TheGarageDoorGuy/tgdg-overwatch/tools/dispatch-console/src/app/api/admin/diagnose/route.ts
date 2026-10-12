import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hcpApi } from "@/lib/hcp-client";
import { businessTimeZone, calendarDayBounds, generateDispatchAvailability, syncWindow } from "@/lib/availability";
import { jobToAppointmentRows } from "@/lib/hcp-sync";
import { DIAGNOSE_VERSION, diagnoseDay, type StoredLookup } from "@/lib/hcp-diagnose";

export const dynamic = "force-dynamic";

// Every response says which version of the report code produced it.
const reply = (body: object, status = 200) => NextResponse.json({ ...body, version: DIAGNOSE_VERSION }, { status });

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// READ-ONLY. "Why isn't this person's booked time showing on this day?" Compares what
// Housecall Pro says against what our sync would record and what our database holds.
// Protected by ADMIN_SYNC_SECRET (the route is disabled if that isn't set).
// Use scripts/hcp-diagnose.mjs rather than calling this by hand.
//   GET ?name=Drayton%20Wilson&date=2026-10-07   (date defaults to tomorrow)
export async function GET(request: NextRequest) {
  const expected = process.env.ADMIN_SYNC_SECRET;
  if (!expected) return reply({ error: "not enabled" }, 404);
  if (!secretMatches(request.headers.get("x-admin-secret") ?? "", expected)) {
    return reply({ error: "forbidden" }, 403);
  }

  const params = new URL(request.url).searchParams;
  const name = params.get("name") ?? "";
  if (!name.trim()) return reply({ error: "name is required" }, 400);

  const now = new Date();
  const date = params.get("date") ?? generateDispatchAvailability(now, []).dates.tomorrow;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return reply({ error: "date must look like YYYY-MM-DD" }, 400);
  }

  try {
    const report = await diagnoseDay(
      {
        hcp: hcpApi,
        timeZone: businessTimeZone(),
        dayBounds: calendarDayBounds,
        syncWindow: syncWindow(now),
        mapJob: jobToAppointmentRows,
        loadStored: async (hcpEmployeeId, start, end): Promise<StoredLookup> => {
          const tech = await prisma.technician.findFirst({ where: { hcpEmployeeId }, select: { id: true } });
          const latest = await prisma.appointment.findFirst({
            orderBy: { updatedAt: "desc" },
            select: { updatedAt: true },
          });
          if (!tech) return { technicianFound: false, rows: [], latestRowUpdate: latest?.updatedAt ?? null };
          const rows = await prisma.appointment.findMany({
            where: { technicianId: tech.id, startTime: { lt: end }, endTime: { gt: start } },
            select: { hcpJobId: true, startTime: true, endTime: true, status: true },
            orderBy: { startTime: "asc" },
          });
          return { technicianFound: true, rows, latestRowUpdate: latest?.updatedAt ?? null };
        },
      },
      { name, date }
    );
    return reply(report, report.ok ? 200 : 404);
  } catch (err) {
    return reply({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
