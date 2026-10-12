import { NextResponse } from "next/server";
import { getFreshness } from "@/lib/sync-status-store";

export const dynamic = "force-dynamic";

// How fresh is the schedule? Safe for any console user: times, a state, and a short message,
// never a host name, key or error detail.
export async function GET() {
  try {
    return NextResponse.json(await getFreshness(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not read the update status." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
