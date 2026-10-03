import { calculatePayPeriods, generateSplitSuggestions, generateOpportunitySuggestions, getCurrentOccurrence, findUnresolvedOccurrences, type Bill, type PaySchedule, type SplitPaymentOverride, type PaidOccurrence, type IncomeSourceInput } from "@split-my-bills/shared";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { ensureRecurringSplits } from "@/lib/split-bill";


export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  const incomeSources = await prisma.incomeSource.findMany({ where: { userId } });
  const bills = await prisma.bill.findMany({ where: { userId } });

  if (!user || incomeSources.length === 0) {
    return NextResponse.json({ periods: [] });
  }

  // Every income source is treated equally — no "primary" schedule drives
  // the app. All real paydays from every source fund all bills together.
  const incomeInputs: IncomeSourceInput[] = incomeSources.map((i) => ({
    amount: Number(i.amount),
    paySchedule: i.frequency as PaySchedule,
    anchorDate: i.nextPayDate,
  }));

  // Backfill any missing recurring-split pairs before we read payment data,
  // so newly generated pairs are reflected in this same request.
  for (const bill of bills) {
    if (bill.splittable && bill.isRecurring) {
      await ensureRecurringSplits(
        {
          id: bill.id,
          dueDate: bill.dueDate,
          amount: Number(bill.amount),
        },
        incomeInputs
      );
    }
  }

  const splitPayments = await prisma.payment.findMany({
    where: {
      bill: { userId },
      isSplitPayment: true,
      status: "SCHEDULED",
    },
    include: { bill: true },
  });

  const overridesByBill = new Map<string, SplitPaymentOverride>();
  for (const payment of splitPayments) {
    if (!payment.paidDate) continue;
    const existing = overridesByBill.get(payment.billId);
    const entry = { date: payment.paidDate, amount: Number(payment.amount) };
    if (existing) {
      existing.payments.push(entry);
    } else {
      overridesByBill.set(payment.billId, {
        billId: payment.billId,
        billName: payment.bill.name,
        payments: [entry],
      });
    }
  }
  const splitOverrides = Array.from(overridesByBill.values());

  const paidPayments = await prisma.payment.findMany({
    where: {
      bill: { userId },
      status: "PAID",
      isSplitPayment: false,
    },
  });

  const paidOccurrences: PaidOccurrence[] = paidPayments
    .filter((p) => p.paidDate !== null)
    .map((p) => ({ billId: p.billId, date: p.paidDate! }));

  const sharedBills: Bill[] = bills.map((b) => ({
    id: b.id,
    name: b.name,
    amount: Number(b.amount),
    dueDate: b.dueDate,
    splittable: b.splittable,
    fundingModel: b.fundingModel,
    isRecurring: b.isRecurring,
  }));

  const periods = calculatePayPeriods(
    incomeInputs,
    sharedBills,
    60,
    splitOverrides,
    paidOccurrences
  );

  const needsReview = periods.length > 0
    ? findUnresolvedOccurrences(
        sharedBills,
        incomeInputs,
        periods[0].start,
        paidOccurrences
      )
    : [];

  const suggestions = generateSplitSuggestions(periods);
  const opportunities = generateOpportunitySuggestions(periods);

  return NextResponse.json({ periods, suggestions, opportunities, needsReview });
}