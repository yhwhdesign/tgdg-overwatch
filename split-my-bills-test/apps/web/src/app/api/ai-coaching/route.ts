import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import {
  calculatePayPeriods,
  generateSplitSuggestions,
  generateOpportunitySuggestions,
  type Bill,
  type PaySchedule,
  type IncomeSourceInput,
} from "@split-my-bills/shared";
import { getAIProvider } from "@/lib/ai/get-provider";
import { canMakeAICall, recordAICall, hashCoachingInput } from "@/lib/ai/usage-governor";

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  const incomeSources = await prisma.incomeSource.findMany({ where: { userId } });
  const bills = await prisma.bill.findMany({ where: { userId } });

  if (!user || incomeSources.length === 0) {
    return NextResponse.json({ coaching: null });
  }

  const incomeInputs: IncomeSourceInput[] = incomeSources.map((i) => ({
    amount: Number(i.amount),
    paySchedule: i.frequency as PaySchedule,
    anchorDate: i.nextPayDate,
  }));

  const sharedBills: Bill[] = bills.map((b) => ({
    id: b.id,
    name: b.name,
    amount: Number(b.amount),
    dueDate: b.dueDate,
    splittable: b.splittable,
    fundingModel: b.fundingModel,
    isRecurring: b.isRecurring,
  }));

  const periods = calculatePayPeriods(incomeInputs, sharedBills);
  const splitSuggestions = generateSplitSuggestions(periods);
  const opportunitySuggestions = generateOpportunitySuggestions(periods);

  const inputData = {
    periods: periods.map((p) => ({
      isCashflowRisk: p.isCashflowRisk,
      shortfall: p.shortfall,
      totalBillAmount: p.totalBillAmount,
    })),
    splitSuggestions,
    opportunitySuggestions,
  };
  const currentHash = hashCoachingInput(inputData);

  const cached = await prisma.aICoachingCache.findUnique({ where: { userId } });
  if (cached && cached.dataHash === currentHash) {
    return NextResponse.json({ coaching: cached.coaching });
  }

  const allowed = await canMakeAICall();
  if (!allowed) {
    return NextResponse.json({
      coaching: null,
      limitReached: true,
    });
  }

  const provider = getAIProvider();

  try {
    const coaching = await provider.generateCoaching({
      periods: periods.map((p) => ({
        payDate: p.payDate.toISOString(),
        isCashflowRisk: p.isCashflowRisk,
        shortfall: p.shortfall,
        isThreePaycheckMonth: p.isThreePaycheckMonth,
        totalBillAmount: p.totalBillAmount,
        income: p.income,
        bills: p.bills.map((b) => ({
          name: b.bill.name,
          amount: b.bill.amount,
          splittable: b.bill.splittable,
        })),
      })),
      splitSuggestions: splitSuggestions.map((s) => ({
        billName: s.billName,
        reasoning: s.reasoning,
        wouldResolve: s.wouldResolve,
      })),
      opportunitySuggestions: opportunitySuggestions.map((o) => ({
        payDate: o.payDate.toISOString(),
        reasoning: o.reasoning,
      })),
    });

    await recordAICall();
    await prisma.aICoachingCache.upsert({
      where: { userId },
      create: { userId, dataHash: currentHash, coaching },
      update: { dataHash: currentHash, coaching },
    });
    return NextResponse.json({ coaching });
  } catch (error) {
    console.error("AI coaching generation failed:", error);
    return NextResponse.json({ coaching: null, error: "AI unavailable" });
  }
}