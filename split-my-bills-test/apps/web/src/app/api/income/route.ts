import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
//import { verifySessionToken } from "@/lib/auth";
//import { cookies } from "next/headers";
import { getCurrentUserId } from "@/lib/session";

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const incomeSources = await prisma.incomeSource.findMany({
    where: { userId },
    orderBy: { nextPayDate: "asc" },
  });

  return NextResponse.json(incomeSources);
}

export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name, amount, frequency, nextPayDate } = await request.json();

  if (!name || !amount || !frequency || !nextPayDate) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const incomeSource = await prisma.incomeSource.create({
    data: {
      userId,
      name,
      amount,
      frequency,
      nextPayDate: new Date(nextPayDate),
    },
  });

  return NextResponse.json(incomeSource, { status: 201 });
}