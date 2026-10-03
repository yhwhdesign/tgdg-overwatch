import { prisma } from "@/lib/prisma";
import {
  planBillSplit,
  pickSplitDates,
  nextOccurrenceOnOrAfter,
  getCurrentOccurrence,
  type PaySchedule,
  type Bill,
  type IncomeSourceInput,
} from "@split-my-bills/shared";

export async function createBillSplit(billId: string, userId: string) {
  const bill = await prisma.bill.findUnique({ where: { id: billId } });
  if (!bill || bill.userId !== userId) {
    throw new Error("Bill not found");
  }
  if (!bill.splittable) {
    throw new Error("Bill is not splittable");
  }

  const incomeSources = await prisma.incomeSource.findMany({ where: { userId } });
  if (incomeSources.length === 0) {
    throw new Error("No income source found");
  }

  const incomeInputs: IncomeSourceInput[] = incomeSources.map((i) => ({
    amount: Number(i.amount),
    paySchedule: i.frequency as PaySchedule,
    anchorDate: i.nextPayDate,
  }));

  const sharedBill: Bill = {
    id: bill.id,
    name: bill.name,
    amount: Number(bill.amount),
    dueDate: bill.dueDate,
    splittable: bill.splittable,
    fundingModel: bill.fundingModel,
    isRecurring: bill.isRecurring,
  };

  const plan = planBillSplit(sharedBill, incomeInputs);

  const splitGroupId = crypto.randomUUID();

  const [firstPayment, secondPayment] = await prisma.$transaction([
    prisma.payment.create({
      data: {
        billId,
        amount: plan.firstPayment.amount,
        status: "SCHEDULED",
        isSplitPayment: true,
        splitGroupId,
        paidDate: plan.firstPayment.date,
        isLate: plan.firstPayment.isLate,
      },
    }),
    prisma.payment.create({
      data: {
        billId,
        amount: plan.secondPayment.amount,
        status: "SCHEDULED",
        isSplitPayment: true,
        splitGroupId,
        paidDate: plan.secondPayment.date,
        isLate: plan.secondPayment.isLate,
      },
    }),
  ]);

  return { firstPayment, secondPayment, splitGroupId };
}

export async function ensureRecurringSplits(
  bill: { id: string; dueDate: number; amount: number },
  incomeSources: IncomeSourceInput[],
  windowDays: number = 60
) {
  const existingLegs = await prisma.payment.findMany({
    where: { billId: bill.id, isSplitPayment: true },
  });

  const groups = new Map<string, Date[]>();
  for (const leg of existingLegs) {
    if (!leg.paidDate || !leg.splitGroupId) continue;
    const dates = groups.get(leg.splitGroupId) ?? [];
    dates.push(leg.paidDate);
    groups.set(leg.splitGroupId, dates);
  }

  let lastFundedDueDate: Date | null = null;
  for (const dates of groups.values()) {
    const maxLegDate = new Date(Math.max(...dates.map((d) => d.getTime())));
    const fundedDueDate = nextOccurrenceOnOrAfter(bill.dueDate, maxLegDate);
    if (!lastFundedDueDate || fundedDueDate > lastFundedDueDate) {
      lastFundedDueDate = fundedDueDate;
    }
  }

  const windowEnd = new Date();
  windowEnd.setUTCDate(windowEnd.getUTCDate() + windowDays);

  // If no split has ever existed for this bill, the FIRST one must target
  // the current cycle's occurrence — whether it's already past or still
  // upcoming — not skip forward to next month just because today happens
  // to be past the due date. Once a real first split exists, walking
  // forward month-by-month (below) is correct recurring behavior.
  const nextTarget = lastFundedDueDate
    ? new Date(lastFundedDueDate)
    : getCurrentOccurrence(bill.dueDate);
  if (lastFundedDueDate) nextTarget.setUTCMonth(nextTarget.getUTCMonth() + 1);

  const created: { splitGroupId: string }[] = [];

  while (nextTarget <= windowEnd) {
    const [firstDate, secondDate] = pickSplitDates(nextTarget, incomeSources);

    // Guard against a concurrent request having already created this exact
    // cycle's split — the dashboard fires GET /api/bills and
    // GET /api/split-suggestions at the same time, and two overlapping
    // calls to this function can each independently see "nothing exists
    // yet" and each create a full duplicate set. Checking for an existing
    // leg at this exact target date closes that window in practice.
    const alreadyExists = await prisma.payment.findFirst({
      where: {
        billId: bill.id,
        isSplitPayment: true,
        paidDate: firstDate,
      },
    });
    if (alreadyExists) {
      nextTarget.setUTCMonth(nextTarget.getUTCMonth() + 1);
      continue;
    }

    const splitGroupId = crypto.randomUUID();
    const half = bill.amount / 2;

    await prisma.$transaction([
      prisma.payment.create({
        data: {
          billId: bill.id,
          amount: half,
          status: "SCHEDULED",
          isSplitPayment: true,
          splitGroupId,
          paidDate: firstDate,
          isLate: firstDate > nextTarget,
        },
      }),
      prisma.payment.create({
        data: {
          billId: bill.id,
          amount: half,
          status: "SCHEDULED",
          isSplitPayment: true,
          splitGroupId,
          paidDate: secondDate,
          isLate: secondDate > nextTarget,
        },
      }),
    ]);

    created.push({ splitGroupId });
    nextTarget.setUTCMonth(nextTarget.getUTCMonth() + 1);
  }

  return created;
}

export async function regenerateSplitsIfNeeded(
  billId: string,
  userId: string,
  isSplittable: boolean
) {
  // Always clear out unpaid split legs — a structural change means "start over."
  // Paid legs are historical fact and are never touched.
  await prisma.payment.deleteMany({
    where: {
      billId,
      isSplitPayment: true,
      status: "SCHEDULED",
    },
  });

  if (!isSplittable) return;

  const bill = await prisma.bill.findUnique({ where: { id: billId } });
  if (!bill || bill.userId !== userId) return;

  const incomeSources = await prisma.incomeSource.findMany({ where: { userId } });
  if (incomeSources.length === 0) {
    console.error("regenerateSplitsIfNeeded: no income source found for user", userId);
    return;
  }

  const incomeInputs: IncomeSourceInput[] = incomeSources.map((i) => ({
    amount: Number(i.amount),
    paySchedule: i.frequency as PaySchedule,
    anchorDate: i.nextPayDate,
  }));

  // IMPORTANT: this calls ensureRecurringSplits(), NOT createBillSplit().
  // createBillSplit() always blindly targets "today's calendar month" with
  // zero awareness of what's already been funded — fine for a genuinely
  // brand-new bill, but WRONG for a repair on a bill that already has real
  // paid history beyond the current month (which is normal for any split
  // bill, by design — they're always funded two paydays ahead). Calling
  // ensureRecurringSplits() here means the repair path correctly looks at
  // whatever PAID history survived the deletion above and advances PAST
  // it, exactly like the automatic recurring-split logic already does
  // correctly every day — instead of duplicating an already-funded cycle.
  try {
    await ensureRecurringSplits(
      {
        id: bill.id,
        dueDate: bill.dueDate,
        amount: Number(bill.amount),
      },
      incomeInputs
    );
  } catch (err) {
    console.error("regenerateSplitsIfNeeded: split generation failed:", err);
  }
}