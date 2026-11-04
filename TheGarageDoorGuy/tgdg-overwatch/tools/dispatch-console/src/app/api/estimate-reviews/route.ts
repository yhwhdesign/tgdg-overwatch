import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// A dispatcher marking an estimate reviewed (or clearing it). Behind the console sign-in like the Estimates page.
// This writes only to OUR database (the EstimateReview table); Housecall Pro is never touched.
//
// POST  { estimateId, reviewedBy, note?, fingerprint }  -> save/replace the review
// DELETE ?id=<estimateId>                               -> clear the review (puts it back on Needs-review)

const ESTIMATE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const FINGERPRINT = /^[A-Za-z0-9]{1,32}$/;

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

export async function POST(request: Request) {
  let body: { estimateId?: unknown; reviewedBy?: unknown; note?: unknown; fingerprint?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  const estimateId = typeof body.estimateId === "string" && ESTIMATE_ID.test(body.estimateId) ? body.estimateId : null;
  if (!estimateId) return NextResponse.json({ error: "A valid estimate id is required." }, { status: 400 });
  const reviewedBy = cleanText(body.reviewedBy, 60);
  if (!reviewedBy) return NextResponse.json({ error: "Set your name first, so the review is signed." }, { status: 400 });
  const note = cleanText(body.note, 500);
  // The snapshot the dispatcher was looking at; if it is ever missing we store an empty one (any later change re-flags).
  const fingerprint = typeof body.fingerprint === "string" && FINGERPRINT.test(body.fingerprint) ? body.fingerprint : "";

  const reviewedAt = new Date();
  const data = { reviewedBy, note, reviewedFingerprint: fingerprint, reviewedAt };
  await prisma.estimateReview.upsert({
    where: { estimateId },
    update: data,
    create: { estimateId, ...data },
  });
  return NextResponse.json({ ok: true, review: { estimateId, reviewedBy, note, reviewedAt: reviewedAt.toISOString() } }, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !ESTIMATE_ID.test(id)) return NextResponse.json({ error: "A valid estimate id is required." }, { status: 400 });
  await prisma.estimateReview.deleteMany({ where: { estimateId: id } });
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
