import crypto from "node:crypto";
import { ADMIN_COOKIE, verifySessionValue } from "@/lib/admin-session";

// The sign-in that keeps the dispatcher screen and its data private once the console is on the internet.
// Same idea as the Admin sign-in: a signed cookie, no database. The cookie is "<expiry-ms>.<signature>", the
// signature is an HMAC of the expiry keyed by CONSOLE_PASSWORD, so it can't be forged without the password,
// it expires by itself, and changing the password signs everyone out.

export const CONSOLE_COOKIE = "overwatch_console";
export const CONSOLE_SESSION_DAYS = 30;

function sign(password: string, expires: string): string {
  return crypto.createHmac("sha256", password).update(`overwatch-console-session:${expires}`).digest("hex");
}

export function createConsoleSession(password: string, now: number = Date.now()): string {
  const expires = String(now + CONSOLE_SESSION_DAYS * 24 * 60 * 60 * 1000);
  return `${expires}.${sign(password, expires)}`;
}

export function verifyConsoleSession(value: string | null | undefined, password: string, now: number = Date.now()): boolean {
  if (!value || !password) return false;
  const dot = value.indexOf(".");
  if (dot < 1) return false;
  const expires = value.slice(0, dot);
  const expiresAt = Number(expires);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  const a = Buffer.from(value.slice(dot + 1));
  const b = Buffer.from(sign(password, expires));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Only ever send people back to a page on this site (never to another site, never to "//host"). */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\r\n]/.test(next)) return "/";
  if (next === "/login" || next.startsWith("/login?")) return "/";
  return next;
}

/**
 * Paths that do NOT need the console sign-in because they protect themselves:
 *  - the sign-in page and its routes
 *  - the Housecall Pro webhook (checks its signature)
 *  - the scheduled refresh (needs CRON_SECRET)
 *  - the Admin screen and its routes (their own password)
 *  - a person's phone-alert setup page and its routes (the private code in their link), and the alerts service worker
 *  - the framework's own files
 */
export function isSelfProtectedPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/api/console/login" ||
    pathname === "/api/console/logout" ||
    pathname === "/api/webhooks" || pathname.startsWith("/api/webhooks/") ||
    pathname === "/api/cron" || pathname.startsWith("/api/cron/") ||
    pathname === "/admin" || pathname.startsWith("/admin/") ||
    pathname === "/api/admin" || pathname.startsWith("/api/admin/") ||
    pathname.startsWith("/join/") ||
    pathname === "/api/push" || pathname.startsWith("/api/push/") ||
    pathname === "/sw.js" ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    /^\/[^/]+\.(svg|png|jpg|jpeg|webp|ico|txt|woff2?)$/i.test(pathname) // the few files in /public
  );
}

export type Access = { kind: "allow" } | { kind: "login" } | { kind: "unauthorized" } | { kind: "closed" };

/**
 * Decide what to do with one request.
 *  - CONSOLE_PASSWORD set: a valid console cookie (or an Admin sign-in) is needed.
 *  - Not set, running on your own computer: open, like before.
 *  - Not set, running on hosting (VERCEL is set): CLOSED, so forgetting the password can never leave it open.
 */
export function decideAccess(input: {
  pathname: string;
  consoleCookie?: string | null;
  adminCookie?: string | null;
  env: Record<string, string | undefined>;
  now?: number;
}): Access {
  if (isSelfProtectedPath(input.pathname)) return { kind: "allow" };
  const password = input.env.CONSOLE_PASSWORD ?? "";
  const isApi = input.pathname === "/api" || input.pathname.startsWith("/api/");
  if (!password) {
    if (input.env.VERCEL) return { kind: "closed" };
    return { kind: "allow" };
  }
  const now = input.now ?? Date.now();
  if (verifyConsoleSession(input.consoleCookie, password, now)) return { kind: "allow" };
  const adminPassword = input.env.ADMIN_PASSWORD ?? "";
  if (adminPassword && verifySessionValue(input.adminCookie, adminPassword, now)) return { kind: "allow" };
  return isApi ? { kind: "unauthorized" } : { kind: "login" };
}

export { ADMIN_COOKIE };
