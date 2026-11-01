import { NextRequest, NextResponse } from "next/server";
import { geocodeAddress } from "@/lib/geocode";

// GET ?address=123 Main St, Little Rock, AR 72201
// Looks the customer's address up once, when the dispatcher presses Continue. The console then
// passes the point (lat, lng) and zip to the technician list and the schedule, so the address is
// only looked up once per call. A bare zip ("72201") works too and skips the lookup.
// Behind the console sign-in like every other API route (see proxy.ts).
export async function GET(request: NextRequest) {
  const address = new URL(request.url).searchParams.get("address") ?? "";
  const result = await geocodeAddress(address);
  if (!result.ok) {
    return NextResponse.json({ error: result.message, reason: result.reason }, { status: result.reason === "unavailable" ? 503 : 400 });
  }
  return NextResponse.json({ place: result.place }, { headers: { "cache-control": "no-store" } });
}
