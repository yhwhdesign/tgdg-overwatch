import crypto from "crypto";

// HCP signs each webhook with Api-Timestamp + Api-Signature headers,
// computed from the signing secret, timestamp, and raw payload.
// Verify BEFORE parsing JSON, using the raw request body.
export function verifyHcpSignature(
  rawBody: string,
  timestamp: string,
  signature: string
): boolean {
  const secret = process.env.HCP_WEBHOOK_SIGNING_SECRET;
  if (!secret) throw new Error("HCP_WEBHOOK_SIGNING_SECRET is not set");

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  // TODO: confirm exact signing scheme (payload/timestamp concatenation order,
  // hash algo) against current HCP docs before going live — placeholder logic above.
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
