import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true, lastReviewedMonth: true },
  });

  return NextResponse.json(user);
}

export async function PATCH(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { lastReviewedMonth } = await request.json();

  if (typeof lastReviewedMonth !== "string") {
    return NextResponse.json({ error: "lastReviewedMonth must be a string" }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: { lastReviewedMonth },
  });

  return NextResponse.json({ lastReviewedMonth: user.lastReviewedMonth });
}