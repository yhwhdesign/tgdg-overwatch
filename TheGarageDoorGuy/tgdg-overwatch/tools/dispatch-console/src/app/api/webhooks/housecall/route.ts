import { NextRequest, NextResponse } from "next/server";
import { verifyHcpSignature } from "@/lib/verify-webhook";

// Receives HCP webhook events, verifies the signature, and upserts into
// our own cache (Appointment / Technician tables via Prisma).
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const timestamp = request.headers.get("Api-Timestamp") ?? "";
  const signature = request.headers.get("Api-Signature") ?? "";

  let verified = false;
  try {
    verified = verifyHcpSignature(rawBody, timestamp, signature);
  } catch (err) {
    console.error("Webhook signature check failed:", err);
  }

  if (!verified) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(rawBody);

  // TODO:
  // 1. Dedupe on event.id against WebhookEvent table (HCP retries deliveries).
  // 2. Upsert the relevant Appointment / Technician row based on event.type.
  console.log("Verified HCP webhook event:", event?.type ?? "unknown");

  return NextResponse.json({ received: true });
}
