import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hcpApi } from "@/lib/hcp-client";
import { verifyHcpSignature } from "@/lib/verify-webhook";
import { syncWindow } from "@/lib/availability";
import { extractJobIds, syncSingleJob, type Db } from "@/lib/hcp-sync";

export const dynamic = "force-dynamic";

const db = prisma as unknown as Db;
let loggedScheme = false;

// Receives HCP webhooks. We deliberately don't trust the payload's contents to
// describe the job: we use it only to learn WHICH job changed, then re-read that
// job from the HCP API and make our rows match. That keeps us correct however
// the payload is shaped, and makes duplicate/retried deliveries harmless.
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const secret = process.env.HCP_WEBHOOK_SIGNING_SECRET;

  // SETUP MODE: HCP sends a test request when you save the webhook URL, before
  // it has issued the signing secret. With no secret configured yet, accept and
  // log the request (nothing is processed or stored) so HCP will save the URL.
  if (!secret) {
    console.log("HCP webhook (setup mode, unverified):", {
      headers: [...request.headers.keys()].join(","),
      body: rawBody.slice(0, 500),
    });
    return NextResponse.json({ received: true, verified: false });
  }

  const verification = verifyHcpSignature(rawBody, request.headers, secret);
  if (!verification.ok) {
    console.error(
      "HCP webhook rejected:",
      verification.detail,
      "| headers seen:",
      [...request.headers.keys()].join(",")
    );
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  if (!loggedScheme) {
    console.log(`HCP webhook signature verified. Matching scheme: ${verification.scheme}`);
    loggedScheme = true;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const obj = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const timestamp = request.headers.get("api-timestamp") ?? request.headers.get("webhook-timestamp") ?? "";
  const eventId =
    request.headers.get("webhook-id") ??
    (typeof obj.event_id === "string" ? obj.event_id : null) ??
    crypto.createHash("sha256").update(`${timestamp}.${rawBody}`).digest("hex");

  // Keep every event for audit (and so we can see real payload shapes later).
  await db.webhookEvent.upsert({
    where: { hcpEventId: eventId },
    update: {},
    create: { hcpEventId: eventId, payload },
  });

  const jobIds = extractJobIds(payload);
  if (jobIds.length === 0) {
    console.log("HCP webhook had no job id; stored for inspection. Top-level keys:", Object.keys(obj).join(","));
    return NextResponse.json({ received: true, action: "none" });
  }

  try {
    const results = [];
    const window = syncWindow(new Date());
    for (const jobId of jobIds) results.push(await syncSingleJob({ db, hcp: hcpApi }, jobId, { window }));
    await db.webhookEvent.update({ where: { hcpEventId: eventId }, data: { processed: true } });
    console.log("HCP webhook processed:", results.map((r) => `${r.jobId}: ${r.result}`).join("; "));
    return NextResponse.json({ received: true, results });
  } catch (err) {
    // 500 so HCP retries; the event row stays processed=false.
    console.error("HCP webhook processing failed:", err);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
