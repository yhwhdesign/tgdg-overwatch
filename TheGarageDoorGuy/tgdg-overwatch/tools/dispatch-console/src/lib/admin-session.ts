import crypto from "node:crypto";

// A tiny signed-cookie session for the Admin screen: no database, no libraries.
// The cookie value is "<expiry-ms>.<signature>", where the signature is an HMAC of the
// expiry keyed by the admin password. So it can't be forged without the password,
// it expires on its own, and changing the password signs everyone out.

export const ADMIN_COOKIE = "overwatch_admin";
export const SESSION_HOURS = 12;

function sign(password: string, expires: string): string {
  return crypto.createHmac("sha256", password).update(`overwatch-admin-session:${expires}`).digest("hex");
}

export function createSessionValue(password: string, now: number = Date.now()): string {
  const expires = String(now + SESSION_HOURS * 60 * 60 * 1000);
  return `${expires}.${sign(password, expires)}`;
}

export function verifySessionValue(
  value: string | null | undefined,
  password: string,
  now: number = Date.now()
): boolean {
  if (!value || !password) return false;
  const dot = value.indexOf(".");
  if (dot < 1) return false;
  const expires = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  const expiresAt = Number(expires);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  return safeEqual(signature, sign(password, expires));
}

/** Constant-time comparison that doesn't leak the password's length. */
export function passwordMatches(provided: string, expected: string): boolean {
  if (!expected) return false;
  const hash = (s: string) => crypto.createHash("sha256").update(s).digest();
  return crypto.timingSafeEqual(hash(provided), hash(expected));
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
