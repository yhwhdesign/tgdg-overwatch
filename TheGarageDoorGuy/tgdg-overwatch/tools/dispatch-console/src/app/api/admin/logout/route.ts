import { NextResponse } from "next/server";
import { ADMIN_COOKIE } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({ name: ADMIN_COOKIE, value: "", path: "/", maxAge: 0 });
  return response;
}
