import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, verifySessionValue } from "@/lib/admin-session";

/**
 * Call at the top of every admin API route. Returns a response to send back when the
 * request must be refused, or null when it's allowed to continue.
 * - No ADMIN_PASSWORD configured: admin is switched off entirely (503).
 * - No valid session cookie: 401.
 * - Anything that changes data must be JSON. A cross-site form can't send that without
 *   a CORS preflight the browser would refuse, which blocks cross-site request forgery
 *   on top of the SameSite=Strict cookie.
 */
export function adminGate(request: NextRequest): NextResponse | null {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    return NextResponse.json(
      { error: "Admin is not enabled. Set ADMIN_PASSWORD in the server's environment." },
      { status: 503 }
    );
  }
  if (!verifySessionValue(request.cookies.get(ADMIN_COOKIE)?.value, password)) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (request.method !== "GET" && !request.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "Requests must be JSON." }, { status: 415 });
  }
  return null;
}
