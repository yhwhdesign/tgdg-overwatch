import { NextResponse } from "next/server";
import { CONSOLE_COOKIE } from "@/lib/console-access";

export const dynamic = "force-dynamic";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({ name: CONSOLE_COOKIE, value: "", httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
