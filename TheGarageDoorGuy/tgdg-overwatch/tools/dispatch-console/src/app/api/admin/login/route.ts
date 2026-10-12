import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, SESSION_HOURS, createSessionValue, passwordMatches } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

// Best-effort guess limiting: 5 wrong passwords per address per 5 minutes. On serverless
// hosting each instance keeps its own count, so this slows guessing rather than stopping
// it. The real protection is choosing a long, random ADMIN_PASSWORD.
const MAX_FAILURES = 5;
const WINDOW_MS = 5 * 60 * 1000;
const failures = new Map<string, { count: number; resetAt: number }>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(request: NextRequest) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return NextResponse.json(
      { error: "Admin is not enabled. Set ADMIN_PASSWORD in the server's environment." },
      { status: 503 }
    );
  }

  const who = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const record = failures.get(who);
  if (record && record.resetAt > now && record.count >= MAX_FAILURES) {
    return NextResponse.json({ error: "Too many attempts. Wait a few minutes and try again." }, { status: 429 });
  }

  let password = "";
  try {
    const body = (await request.json()) as { password?: unknown };
    if (typeof body.password === "string") password = body.password;
  } catch {
    return NextResponse.json({ error: "Send the password as JSON." }, { status: 400 });
  }

  if (!passwordMatches(password, expected)) {
    const current = record && record.resetAt > now ? record : { count: 0, resetAt: now + WINDOW_MS };
    failures.set(who, { count: current.count + 1, resetAt: current.resetAt });
    await sleep(400); // makes each wrong guess cost time
    return NextResponse.json({ error: "Wrong password." }, { status: 401 });
  }

  failures.delete(who);
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: ADMIN_COOKIE,
    value: createSessionValue(expected),
    httpOnly: true, // page scripts can't read it
    sameSite: "strict", // never sent on cross-site requests
    secure: process.env.NODE_ENV === "production", // https only once deployed
    path: "/",
    maxAge: SESSION_HOURS * 60 * 60,
  });
  return response;
}
