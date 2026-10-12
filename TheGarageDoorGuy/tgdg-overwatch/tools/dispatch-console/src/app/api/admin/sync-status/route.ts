import { NextResponse, type NextRequest } from "next/server";
import { adminGate } from "@/lib/admin-auth";
import { getAdminStatus } from "@/lib/sync-status-store";

export const dynamic = "force-dynamic";

// The fuller refresh status for the Admin screen (includes error detail and the timer's state).
export async function GET(request: NextRequest) {
  const denied = adminGate(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await getAdminStatus(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message.slice(0, 200) : "Could not read the status." }, { status: 503 });
  }
}
