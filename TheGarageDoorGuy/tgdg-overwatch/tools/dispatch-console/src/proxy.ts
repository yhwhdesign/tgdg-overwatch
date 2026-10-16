import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, CONSOLE_COOKIE, decideAccess } from "@/lib/console-access";

// Runs before every page and API request (Next 16 calls this file "proxy"). The rules live in
// lib/console-access.ts so they can be tested without a server.
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const access = decideAccess({
    pathname,
    consoleCookie: request.cookies.get(CONSOLE_COOKIE)?.value,
    adminCookie: request.cookies.get(ADMIN_COOKIE)?.value,
    env: process.env,
  });
  if (access.kind === "allow") return NextResponse.next();
  if (access.kind === "unauthorized") {
    return NextResponse.json({ error: "Sign in to the console first." }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  if (access.kind === "closed") {
    return new NextResponse("This console is locked: CONSOLE_PASSWORD is not set on the server.", { status: 503, headers: { "cache-control": "no-store" } });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
