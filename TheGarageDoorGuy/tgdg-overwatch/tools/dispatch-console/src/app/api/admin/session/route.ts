import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, verifySessionValue } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

// "Is this visitor signed in as admin?" A plain yes or no, never an error, so the desktop panel can decide
// whether to show its settings cog and the Reports tab. It only checks the sign-in cookie's signature and
// expiry: no database, no data, nothing but a yes or a no. The answer is also "no" when admin is switched off.
export async function GET(request: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;
  const noStore = { headers: { "Cache-Control": "no-store" } };
  if (!password) return NextResponse.json({ enabled: false, signedIn: false }, noStore);
  const signedIn = verifySessionValue(request.cookies.get(ADMIN_COOKIE)?.value, password);
  return NextResponse.json({ enabled: true, signedIn }, noStore);
}
