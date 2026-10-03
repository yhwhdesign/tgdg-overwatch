import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth";

const protectedRoutes = ["/dashboard"];
const authRoutes = ["/login", "/signup"];

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const token = request.cookies.get("session")?.value;
  console.log("PROXY DEBUG - path:", path, "| token exists:", !!token);

  const session = token ? await verifySessionToken(token) : null;
  console.log("PROXY DEBUG - session:", session);

  if (protectedRoutes.some((route) => path.startsWith(route)) && !session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (authRoutes.some((route) => path.startsWith(route)) && session) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/login", "/signup"],
};