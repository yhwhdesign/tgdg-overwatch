import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { createBillSplit } from "@/lib/split-bill";
import { getCurrentOccurrence, nextOccurrenceOnOrAfter } from "@split-my-bills/shared";

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const bills = await prisma.bill.findMany({
    where: { userId },
    orderBy: { dueDate: "asc" },
    include: {
      payments: true,
    },
  });

  const billsWithStatus = bills.map((b) => {
    const currentOccurrence = getCurrentOccurrence(b.dueDate);

    // Matched by calendar day (UTC components), not an exact timestamp
    // range — local dev and production can construct "midnight" a few
    // hours apart depending on server timezone, and an exact-range match
    // can miss a row created in the other environment.
    const matchingPaid = b.payments.find(
      (p) =>
        p.status === "PAID" &&
        !p.isSplitPayment &&
        p.paidDate &&
        p.paidDate.getUTCFullYear() === currentOccurrence.getUTCFullYear() &&
        p.paidDate.getUTCMonth() === currentOccurrence.getUTCMonth() &&
        p.paidDate.getUTCDate() === currentOccurrence.getUTCDate()
    );

    const paidThisMonth = !!matchingPaid;
    const paidAmount = matchingPaid ? matchingPaid.amount : null;

    // Was LAST month's occurrence ever actually paid? isOverdue only ever
    // checks THIS month's occurrence, so a bill due late in the month
    // (e.g. the 25th) can silently "age out" the moment the calendar
    // rolls to a new month — its current occurrence isn't due yet, so
    // isOverdue is false, but nothing ever confirmed last month's was
    // handled. Split bills already have this protection via
    // previousSplitGroupId; this gives non-split bills the same coverage.
    const previousOccurrence = new Date(currentOccurrence);
    previousOccurrence.setUTCMonth(previousOccurrence.getUTCMonth() - 1);
    const previousMonthPaid = b.payments.some(
      (p) =>
        p.status === "PAID" &&
        !p.isSplitPayment &&
        p.paidDate &&
        p.paidDate.getUTCFullYear() === previousOccurrence.getUTCFullYear() &&
        p.paidDate.getUTCMonth() === previousOccurrence.getUTCMonth() &&
        p.paidDate.getUTCDate() === previousOccurrence.getUTCDate()
    );
    const startOfCurrentMonth = new Date(
      Date.UTC(currentOccurrence.getUTCFullYear(), currentOccurrence.getUTCMonth(), 1)
    );
    const previousMonthUnpaid =
      !b.splittable && !previousMonthPaid && b.createdAt < startOfCurrentMonth;

    const splitPayments = b.payments.filter(
      (p) => p.isSplitPayment && p.status === "SCHEDULED"
    );
    const hasActiveSplit = splitPayments.length > 0;

    let isOverdue: boolean;
    let currentSplitGroupId: string | null = null;
    let previousSplitGroupId: string | null = null;

    if (b.splittable) {
      // Split legs are always dated BEFORE the due date they fund (that's
      // the whole point — paying ahead from the two most recent checks),
      // so comparing a leg's own date against the due date can never
      // resolve "overdue." Instead: figure out which due-date occurrence
      // each splitGroupId actually funds (same logic ensureRecurringSplits
      // uses), and check whether the group funding THIS cycle is fully paid.
      const groups = new Map<string, typeof b.payments>();
      for (const p of b.payments) {
        if (!p.isSplitPayment || !p.splitGroupId) continue;
        const arr = groups.get(p.splitGroupId) ?? [];
        arr.push(p);
        groups.set(p.splitGroupId, arr);
      }

      // For each group, compute the occurrence it actually funds, and
      // compare it against the CURRENT and PREVIOUS cycles. This is what
      // lets the Bills list show only "this month's" split group by
      // default, plus the immediately-prior one if it's still unresolved
      // — instead of every group ever generated, all at once.
      const previousOccurrence = new Date(currentOccurrence);
      previousOccurrence.setUTCMonth(previousOccurrence.getUTCMonth() - 1);

      let currentCycleFunded = false;

      for (const [groupId, legs] of groups.entries()) {
        const dated = legs.filter((l) => l.paidDate);
        if (dated.length === 0) continue;
        const maxLegDate = new Date(Math.max(...dated.map((l) => l.paidDate!.getTime())));
        const fundedDueDate = nextOccurrenceOnOrAfter(b.dueDate, maxLegDate);

        const isSameOccurrence = (a: Date, c: Date) =>
          a.getUTCFullYear() === c.getUTCFullYear() &&
          a.getUTCMonth() === c.getUTCMonth() &&
          a.getUTCDate() === c.getUTCDate();

        if (isSameOccurrence(fundedDueDate, currentOccurrence)) {
          currentSplitGroupId = groupId;
          if (legs.every((l) => l.status === "PAID")) {
            currentCycleFunded = true;
          }
        } else if (isSameOccurrence(fundedDueDate, previousOccurrence)) {
          // Only surface the previous cycle's group if it's NOT fully
          // paid — a resolved past cycle doesn't need to keep showing.
          if (!legs.every((l) => l.status === "PAID")) {
            previousSplitGroupId = groupId;
          }
        }
      }

      isOverdue = currentOccurrence < new Date() && !currentCycleFunded;
    } else {
      isOverdue = !paidThisMonth && currentOccurrence < new Date();
    }

    return {
      ...b,
      paidThisMonth,
      paidAmount,
      isOverdue,
      hasActiveSplit,
      hasLateSplit: splitPayments.some((p) => p.isLate),
      currentSplitGroupId,
      previousSplitGroupId,
      previousMonthUnpaid,
    };
  });

  return NextResponse.json(billsWithStatus);
}

export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name, amount, dueDate, category, splittable, fundingModel } = await request.json();

  if (!name || !amount || !dueDate) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const bill = await prisma.bill.create({
    data: {
      userId,
      name,
      amount,
      dueDate: Number(dueDate),
      category: category || null,
      splittable: !!splittable,
      fundingModel: fundingModel === "NEXT_CHECK" ? "NEXT_CHECK" : "BEFORE_DUE",
    },
  });

  let splitWarning: string | null = null;

  if (bill.splittable) {
    try {
      await createBillSplit(bill.id, userId);
    } catch (err: any) {
      console.error("Auto-split on bill creation failed:", err);
      splitWarning =
        err.message === "No income source found"
          ? "Bill added, but couldn't auto-split yet — add an income source first, then split it manually."
          : "Bill added, but auto-split failed. You can try splitting it manually.";
    }
  }

  return NextResponse.json({ bill, splitWarning }, { status: 201 });
}