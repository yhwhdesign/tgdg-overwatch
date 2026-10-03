import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: paymentId } = await params;

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { bill: true },
  });

  if (!payment || payment.bill.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!payment.isSplitPayment) {
    return NextResponse.json(
      { error: "This endpoint is for split-payment legs only" },
      { status: 400 }
    );
  }

  // Optional actual-amount override — same pattern as the non-split bill
  // pay route. Falls back to the leg's own planned amount if no override
  // is sent, or if it's not a valid positive number.
  let paidAmount: number = Number(payment.amount);
  try {
    const body = await request.json();
    if (body && typeof body.amount === "number" && body.amount > 0) {
      paidAmount = body.amount;
    }
  } catch {
    // No body sent — quick-toggle paid at the planned amount.
  }

  const updated = await prisma.payment.update({
    where: { id: paymentId },
    data: { status: "PAID", paidAmount },
  });

  return NextResponse.json(updated, { status: 200 });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: paymentId } = await params;

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { bill: true },
  });

  if (!payment || payment.bill.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!payment.isSplitPayment) {
    return NextResponse.json(
      { error: "This endpoint is for split-payment legs only" },
      { status: 400 }
    );
  }

  const updated = await prisma.payment.update({
    where: { id: paymentId },
    data: { status: "SCHEDULED", paidAmount: null },
  });

  return NextResponse.json(updated, { status: 200 });
}