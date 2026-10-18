import { NextResponse } from "next/server";
import { pushConfig } from "@/lib/push";

export const dynamic = "force-dynamic";

// The public half of the server's push key. A phone needs it to register for alerts; it is meant to be public.
export async function GET() {
  const config = pushConfig();
  if (!config) return NextResponse.json({ error: "Phone alerts are not set up yet." }, { status: 503, headers: { "cache-control": "no-store" } });
  return NextResponse.json({ publicKey: config.publicKey }, { headers: { "cache-control": "no-store" } });
}
