import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { createBillSplit } from "@/lib/split-bill";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: billId } = await params;

  try {
    const result = await createBillSplit(billId, userId);
    return NextResponse.json(result);
  } catch (err: any) {
    const status = err.message === "Bill not found" ? 404 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}