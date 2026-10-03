"use client";

import { DayOfMonthPicker } from "@/components/day-of-month-picker";
import { EditBillModal } from "@/components/edit-bill-modal";
import { EditIncomeModal } from "@/components/edit-income-modal";
import { PayBillMenu } from "@/components/pay-bill-menu";
import { SplitLegPayModal } from "@/components/split-leg-pay-modal";
import { SplitSquareHorizontal, AlertTriangle, HelpCircle, Menu, Info, LogOut, MoreVertical } from "lucide-react";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { normalizeToMonthly, getPayDatesInRange, type PaySchedule } from "@split-my-bills/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Pencil,
  Trash2,
  Check,
  X,
  CheckCircle2,
  Circle,
  Home,
  Zap,
  Wifi,
  Car,
  HeartPulse,
  Tag,
  Droplet,
  Flame,
  Phone,
  Tv,
  CreditCard,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { InstallPrompt } from "@/components/install-prompt";
import { suggestCategory } from "@/lib/categorize-bill";
import { MonthlyReviewModal } from "@/components/monthly-review-modal";

type IncomeSource = {
  id: string;
  name: string;
  amount: string;
  frequency: string;
  nextPayDate: string;
};

type SplitPaymentLeg = {
  id: string;
  amount: string;
  paidAmount: string | null;
  paidDate: string;
  status: string;
  isSplitPayment: boolean;
  splitGroupId: string | null;
};

type Bill = {
  id: string;
  name: string;
  amount: string;
  dueDate: number;
  category: string | null;
  splittable: boolean;
  fundingModel: "BEFORE_DUE" | "NEXT_CHECK";
  paidThisMonth: boolean;
  paidAmount: string | null;
  isRecurring: boolean;
  hasActiveSplit: boolean;
  hasLateSplit: boolean;
  currentSplitGroupId: string | null;
  previousSplitGroupId: string | null;
  payments: SplitPaymentLeg[];
  isOverdue: boolean;
  previousMonthUnpaid: boolean;
  previousOccurrenceDate: string | null;
  currentOccurrenceDate: string;
};

type NeedsReviewItem = {
  billId: string;
  billName: string;
  amount: number;
  dueDate: string;
};

export default function DashboardPage() {
  const router = useRouter();
  const [income, setIncome] = useState<IncomeSource[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [periods, setPeriods] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [needsReview, setNeedsReview] = useState<NeedsReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingIncomeId, setEditingIncomeId] = useState<string | null>(null);
  const [editingBillId, setEditingBillId] = useState<string | null>(null);
  const [payingLegId, setPayingLegId] = useState<string | null>(null);
  const [menuBillId, setMenuBillId] = useState<string | null>(null);
  const [expandedPeriod, setExpandedPeriod] = useState<number | null>(null);
  const [reviewingBillId, setReviewingBillId] = useState<string | null>(null);
  const [coaching, setCoaching] = useState<string | null>(null);
  const [coachingLoading, setCoachingLoading] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [userName, setUserName] = useState<string | null>(null);
  const [userLastReviewedMonth, setUserLastReviewedMonth] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [pastDueModalOpen, setPastDueModalOpen] = useState(false);
  const [dueModalOpen, setDueModalOpen] = useState(false);
  const [monthlyReviewOpen, setMonthlyReviewOpen] = useState(false);
  const [monthlyReviewBills, setMonthlyReviewBills] = useState<
  { id: string; name: string; amount: string; occurrenceDate: string }[]
>([]);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!loading) {
      loadCoaching();
    }
  }, [loading]);

  useEffect(() => {
    if (loading) return;
    const overdueBills = bills.filter(
      (b) => b.isOverdue || b.previousMonthUnpaid || !!b.previousSplitGroupId
    );
    if (overdueBills.length > 0) {
      setMonthlyReviewBills(
  overdueBills.map((b) => ({
    id: b.id,
    name: b.name,
    amount: b.amount,
    occurrenceDate: b.previousMonthUnpaid ? b.previousOccurrenceDate! : b.currentOccurrenceDate,
  }))
);
      setMonthlyReviewOpen(true);
    }
  }, [loading, bills]);

  async function loadData() {
    const [incomeRes, billsRes, periodsRes, userRes] = await Promise.all([
      fetch("/api/income"),
      fetch("/api/bills"),
      fetch("/api/split-suggestions"),
      fetch("/api/user/me"),
    ]);
    setIncome(await incomeRes.json());
    setBills(await billsRes.json());
    const periodsData = await periodsRes.json();
    setPeriods(periodsData.periods ?? []);
    setSuggestions(periodsData.suggestions ?? []);
    setOpportunities(periodsData.opportunities ?? []);
    setNeedsReview(periodsData.needsReview ?? []);
    const userData = await userRes.json();
    setUserName(userData.name ?? null);
    setUserLastReviewedMonth(userData.lastReviewedMonth ?? null);
    setLoading(false);
  }

  async function loadCoaching() {
    setCoachingLoading(true);
    const res = await fetch("/api/ai-coaching");
    const data = await res.json();
    setCoaching(data.coaching);
    setLimitReached(!!data.limitReached);
    setCoachingLoading(false);
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  async function handleAddIncome(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    await fetch("/api/income", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        amount: Number(formData.get("amount")),
        frequency: formData.get("frequency"),
        nextPayDate: formData.get("nextPayDate"),
      }),
    });
    form.reset();
    loadData();
  }

  async function handleQuickSpend(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    const isRecurring = formData.get("isRecurring") === "on";
    const today = new Date();
    await fetch("/api/bills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        amount: Number(formData.get("amount")),
        dueDate: today.getDate(),
        category: null,
        splittable: false,
        fundingModel: "BEFORE_DUE",
        isRecurring,
        markPaidNow: true,
      }),
    });
    form.reset();
    loadData();
  }

  async function handleAddBill(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    await fetch("/api/bills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        amount: Number(formData.get("amount")),
        dueDate: formData.get("dueDate"),
        category: formData.get("category"),
        splittable: formData.get("splittable") === "on",
        fundingModel: formData.get("fundingModel"),
      }),
    });
    form.reset();
    loadData();
  }

  async function handleDeleteIncome(id: string) {
    await fetch(`/api/income/${id}`, { method: "DELETE" });
    loadData();
  }

  async function handleDeleteBill(id: string) {
    await fetch(`/api/bills/${id}`, { method: "DELETE" });
    setMenuBillId(null);
    loadData();
  }

  async function handleUpdateIncome(
    id: string,
    updates: { name: string; amount: number; frequency: string; nextPayDate: string }
  ) {
    await fetch(`/api/income/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    setEditingIncomeId(null);
    loadData();
  }

  async function handleUpdateBill(
    id: string,
    updates: {
      name: string;
      amount: number;
      dueDate: number;
      category: string;
      splittable: boolean;
      fundingModel: string;
    }
  ) {
    await fetch(`/api/bills/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    setEditingBillId(null);
    loadData();
  }

  async function handleTogglePaid(billId: string, currentlyPaid: boolean) {
    await fetch(`/api/bills/${billId}/pay`, {
      method: currentlyPaid ? "DELETE" : "POST",
    });
    loadData();
  }

  async function handleMarkPaidAmount(billId: string, amount: number) {
    await fetch(`/api/bills/${billId}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount }),
    });
    setMenuBillId(null);
    loadData();
  }

  async function handleToggleSplitPaymentPaid(paymentId: string, currentlyPaid: boolean) {
    await fetch(`/api/payments/${paymentId}/pay`, {
      method: currentlyPaid ? "DELETE" : "POST",
    });
    loadData();
  }

  async function handleMarkSplitLegPaidAmount(paymentId: string, amount: number) {
    await fetch(`/api/payments/${paymentId}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount }),
    });
    setPayingLegId(null);
    loadData();
  }

  async function handleSplitBill(billId: string) {
    await fetch(`/api/bills/${billId}/split`, { method: "POST" });
    loadData();
  }

  async function handleResolveNeedsReview(billId: string, wasPaid: boolean) {
    if (wasPaid) {
      await fetch(`/api/bills/${billId}/pay`, { method: "POST" });
      loadData();
    }
    setReviewingBillId(null);
  }

  async function handleMonthlyReviewResolve(billId: string, wasPaid: boolean, occurrenceDate: string) {
  if (wasPaid) {
    await fetch(`/api/bills/${billId}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ occurrenceDate }),
    });
    loadData();
  }
}

  function handleMonthlyReviewClose(allResolved: boolean) {
    setMonthlyReviewOpen(false);
    if (allResolved) {
      const now = new Date();
      const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
      setUserLastReviewedMonth(monthKey);
      fetch("/api/user/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lastReviewedMonth: monthKey }),
      }).catch((err) => console.error("Failed to save lastReviewedMonth:", err));
    }
  }

  const needsReviewBillIds = new Set(needsReview.map((n) => n.billId));
  const editingBill = bills.find((b) => b.id === editingBillId) ?? null;
  const editingIncome = income.find((i) => i.id === editingIncomeId) ?? null;
  const menuBill = bills.find((b) => b.id === menuBillId) ?? null;
  const payingLeg =
    bills.flatMap((b) => b.payments).find((p) => p.id === payingLegId) ?? null;
  const billsNeedingAttention = bills.filter(
    (b) => b.isOverdue || b.previousMonthUnpaid || !!b.previousSplitGroupId
  ).length;

  const totalBillsThisMonth = bills
    .filter((b) => b.isRecurring)
    .reduce((sum, b) => sum + Number(b.amount), 0);

  const totalIncome = income.reduce(
    (sum, i) => sum + normalizeToMonthly(Number(i.amount), i.frequency as PaySchedule),
    0
  );

  const rawIncomeTotal = income.reduce((sum, i) => sum + Number(i.amount), 0);

  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const endOfYearUTC = new Date(Date.UTC(now.getUTCFullYear(), 11, 31));
  const startOfMonthUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const projectedIncomeToYearEnd = income.reduce((sum, i) => {
    const dates = getPayDatesInRange(
      i.frequency as PaySchedule,
      new Date(i.nextPayDate),
      startOfMonthUTC,
      endOfYearUTC
    );
    return sum + dates.length * Number(i.amount);
  }, 0);

  const totalBills = bills.reduce((sum, b) => sum + Number(b.amount), 0);
  const currentPeriod = periods.length > 0 ? periods[0] : null;
  const periodRemaining = currentPeriod
    ? currentPeriod.income - currentPeriod.totalBillAmount
    : totalIncome - totalBills;

  const dueBeforeNextPaydayCount = (currentPeriod?.bills.length ?? 0) + needsReview.length;
  const dueBeforeNextPaydayAmount =
    (currentPeriod?.totalBillAmount ?? 0) + needsReview.reduce((sum, n) => sum + n.amount, 0);

  const projectedRemainingThruNextMonth = periods
    .filter((p) => new Date(p.start) <= endOfYearUTC)
    .reduce((sum, p) => sum + (p.income - p.totalBillAmount), 0);

  const actualSpentSoFar = currentPeriod
    ? bills.reduce((sum, b) => {
        if (b.hasActiveSplit) {
          const paidLegsInPeriod = b.payments.filter(
            (p) =>
              p.isSplitPayment &&
              p.status === "PAID" &&
              p.paidDate &&
              new Date(p.paidDate) >= new Date(currentPeriod.start) &&
              new Date(p.paidDate) < new Date(currentPeriod.end)
          );
          return sum + paidLegsInPeriod.reduce((s, p) => s + Number(p.paidAmount ?? p.amount), 0);
        }

        if (!b.paidThisMonth) return sum;

        const paidRow = b.payments.find((p) => p.status === "PAID" && !p.isSplitPayment);
        if (!paidRow || !paidRow.paidDate) return sum;
        const paidDate = new Date(paidRow.paidDate);
        if (paidDate < new Date(currentPeriod.start) || paidDate >= new Date(currentPeriod.end)) {
          return sum;
        }

        return sum + Number(b.paidAmount ?? b.amount);
      }, 0)
    : 0;

  const actualRemaining = currentPeriod ? currentPeriod.income - actualSpentSoFar : null;

  if (loading) {
    return <main className="p-8">Loading...</main>;
  }

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-8 space-y-6 sm:space-y-8">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <Logo />
          <p className="text-sm text-muted-foreground mt-1">
            {userName ? `Welcome back, ${userName}` : "Here's where things stand today"}
          </p>
        </div>
        <div className="relative shrink-0">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="p-2 rounded-md hover:bg-muted transition-colors"
            aria-label="Menu"
          >
            <Menu size={20} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-2 w-48 rounded-md border bg-background shadow-md z-10 overflow-hidden">
              <button
                onClick={() => {
                  setLegendOpen(true);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors text-left"
              >
                <Info size={14} />
                Icon Legend
              </button>
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors text-left"
              >
                <LogOut size={14} />
                Log out
              </button>
            </div>
          )}
        </div>
      </div>

      {legendOpen && (
        <Card className="shadow-sm border-border/50 py-6">
          <CardHeader>
            <CardTitle>Icon Legend</CardTitle>
            <CardDescription>What the icons on your bills mean</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <SplitSquareHorizontal size={14} className="text-primary" />
              <span>This bill is split into two payments</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="text-yellow-600" />
              <span>A split payment for this bill is scheduled late</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="text-red-500" />
              <span>This bill's due date has passed and it isn't marked paid</span>
            </div>
            <div className="flex items-center gap-2">
              <HelpCircle size={14} className="text-blue-500" />
              <span>
                This bill has an earlier occurrence the app can't confirm — tap it to say
                whether it was paid
              </span>
            </div>
            <Button size="sm" variant="outline" onClick={() => setLegendOpen(false)}>
              Close
            </Button>
          </CardContent>
        </Card>
      )}

      <InstallPrompt />

      <div className="rounded-2xl bg-zinc-900 p-6 sm:p-8 shadow-lg">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-400">
  Projected Income (thru {endOfYearUTC.toLocaleDateString(undefined, { timeZone: "UTC" })})
</p>
            <p className="text-3xl font-bold text-white mt-1">${projectedIncomeToYearEnd.toFixed(2)}</p>
            <p className="text-xs text-zinc-500 mt-2">
              Current paycheck: <span className="text-zinc-300">${(currentPeriod?.income ?? 0).toFixed(2)}</span>
            </p>
          </div>
          <div className="sm:border-l sm:border-zinc-700 sm:pl-4">
            <p className="text-xs uppercase tracking-wide text-zinc-400">Total Bills This Month</p>
            <p className="text-3xl font-bold text-white mt-1">${totalBillsThisMonth.toFixed(2)}</p>
            {currentPeriod && (
              <button
                onClick={() => setDueModalOpen(true)}
                className="text-xs text-zinc-500 mt-2 underline decoration-dotted hover:text-zinc-300 text-left"
              >
                Due before next payday: <span className="text-zinc-300">{dueBeforeNextPaydayCount} bill{dueBeforeNextPaydayCount !== 1 ? "s" : ""}, ${dueBeforeNextPaydayAmount.toFixed(2)}</span>
              </button>
            )}
            <p className="text-xs mt-1">
              {billsNeedingAttention === 0 ? (
                <span className="text-primary">✓ All bills paid</span>
              ) : (
                <button
                  onClick={() => setPastDueModalOpen(true)}
                  className="text-red-400 underline decoration-dotted hover:text-red-300"
                >
                  {billsNeedingAttention} bill{billsNeedingAttention !== 1 ? "s" : ""} past due
                </button>
              )}
            </p>
          </div>
          <div className="sm:border-l sm:border-zinc-700 sm:pl-4">
            <p className="text-xs uppercase tracking-wide text-zinc-400">
              Projected Remaining (thru {endOfYearUTC.toLocaleDateString(undefined, { timeZone: "UTC" })})
            </p>
            {(() => {
              const periodTotal = currentPeriod ? currentPeriod.income : totalIncome;
              const usedRatio = periodTotal > 0 ? (periodTotal - periodRemaining) / periodTotal : 0;
              const isNegative = projectedRemainingThruNextMonth < 0;
              const isTight = !isNegative && usedRatio > 0.8;

              const colorClass = isNegative
                ? "text-red-400"
                : isTight
                ? "text-yellow-400"
                : "text-primary";

              return (
                <>
                  <p className={`text-3xl font-bold mt-1 flex items-center gap-2 ${colorClass}`}>
                    ${projectedRemainingThruNextMonth.toFixed(2)}
                    {(isNegative || isTight) && <AlertTriangle size={20} />}
                  </p>
                  {currentPeriod && (
                    <p className="text-xs text-zinc-500 mt-2">
                      This payday to next: <span className="text-zinc-300">${periodRemaining.toFixed(2)}</span>
                    </p>
                  )}
                  {actualRemaining !== null && (
                    <p className="text-xs text-zinc-500 mt-1">
                      Actual so far: <span className="text-zinc-300">${actualRemaining.toFixed(2)}</span>
                    </p>
                  )}
                </>
              );
            })()}
          </div>
        </div>

        {totalIncome > 0 && (
          <div className="mt-6 pt-6 border-t border-zinc-700">
            <div className="flex justify-between text-xs text-zinc-400 mb-2">
              <span>Bills committed</span>
              <span>{Math.min(100, Math.round((totalBills / totalIncome) * 100))}% of income</span>
            </div>
            <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  totalBills / totalIncome > 1
                    ? "bg-red-400"
                    : totalBills / totalIncome > 0.8
                    ? "bg-yellow-400"
                    : "bg-primary"
                }`}
                style={{ width: `${Math.min(100, (totalBills / totalIncome) * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <Card className="border-primary/30 bg-primary/5 shadow-sm py-6">
        <CardHeader>
          <CardTitle>Your AI Coach</CardTitle>
        </CardHeader>
        <CardContent>
          {coachingLoading ? (
            <p className="text-muted-foreground text-sm">Thinking...</p>
          ) : limitReached ? (
            <p className="text-muted-foreground text-sm">
              AI suggestions have reached today&apos;s limit — your bills and split suggestions
              above are still fully accurate. Check back tomorrow for AI coaching.
            </p>
          ) : coaching ? (
            <p className="text-sm whitespace-pre-wrap">{coaching}</p>
          ) : (
            <p className="text-muted-foreground text-sm">No suggestions available right now.</p>
          )}
        </CardContent>
      </Card>

      {periods.length > 0 && (
        <Card className="shadow-sm border-border/50 py-6">
          <CardHeader>
            <CardTitle>Upcoming Pay Periods</CardTitle>
            <CardDescription>Based on your pay schedule and bills</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {periods.map((p, idx) => (
              <div
                key={idx}
                className={`rounded-md border text-sm ${
                  p.isCashflowRisk ? "border-destructive/50 bg-destructive/5" : "border-border"
                }`}
              >
                <button
                  onClick={() => setExpandedPeriod(expandedPeriod === idx ? null : idx)}
                  className="flex w-full items-center justify-between gap-2 p-3 text-left flex-wrap"
                >
                  <div>
                    <div className="font-medium">
                      {new Date(p.payDate).toLocaleDateString(undefined, { timeZone: "UTC"})}
                      {p.bonusPaycheckLabels?.map((label: string) => (
                        <span key={label} className="ml-2 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold px-2 py-0.5 tracking-wide align-middle">
                          {label}
                        </span>
                      ))}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {p.bills.length} bill{p.bills.length !== 1 ? "s" : ""} — $
                      {p.totalBillAmount.toFixed(2)} due
                    </div>
                  </div>
                  {p.isCashflowRisk ? (
                    <span className="rounded-full bg-destructive/10 text-destructive text-xs font-semibold px-2.5 py-1">
                      Short ${p.shortfall.toFixed(2)}
                    </span>
                  ) : (
                    <span className="rounded-full bg-primary/10 text-primary text-xs font-semibold px-2.5 py-1">
                      On track
                    </span>
                  )}
                </button>

                {expandedPeriod === idx && p.bills.length > 0 && (
                  <div className="border-t px-3 py-2 space-y-1">
                    {p.bills.map((item: any, i: number) => (
                      <div key={i} className="flex justify-between text-xs text-muted-foreground">
                        <span className="font-medium">{item.bill.name}</span>
                        <span className="font-semibold">${item.bill.amount.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {suggestions.length > 0 && (
        <Card className="border-primary/30 bg-primary/5 shadow-sm py-6">
          <CardHeader>
            <CardTitle>Split Suggestions</CardTitle>
            <CardDescription>Ways to smooth out tight pay periods</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {suggestions.map((s, idx) => (
              <div key={idx} className="rounded-md border border-primary/20 bg-background p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{s.billName}</span>
                  <span
                    className={`text-xs font-medium ${
                      s.wouldResolve ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    {s.wouldResolve ? "Resolves shortfall" : "Partial help"}
                  </span>
                </div>
                <p className="text-muted-foreground text-xs mt-1">{s.reasoning}</p>
                <Button
                  size="sm"
                  className="mt-2 font-semibold"
                  onClick={() => handleSplitBill(s.billId)}
                >
                  Split this bill
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {opportunities.length > 0 && (
        <Card className="border-primary/30 bg-primary/5 shadow-sm py-6">
          <CardHeader>
            <CardTitle>Extra Paycheck Opportunities</CardTitle>
            <CardDescription>An extra paycheck this pay cycle — good chances to get ahead</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {opportunities.map((o, idx) => (
              <div key={idx} className="rounded-md border border-primary/20 bg-background p-3 text-sm">
                <div className="font-medium flex items-center gap-2">
                  {new Date(o.payDate).toLocaleDateString(undefined, { timeZone: "UTC"})}
                  {o.bonusPaycheckLabels?.map((label: string) => (
                    <span key={label} className="rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold px-2 py-0.5 tracking-wide">
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Card className="shadow-sm border-border/50 py-6">
          <CardHeader>
            <CardTitle>Income Sources</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {income.map((i) => (
              <div key={i.id} className="flex items-start justify-between gap-2 text-sm border-b pb-2">
                <span className="font-medium min-w-0 break-words flex-1">{i.name}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-semibold min-w-[70px] text-right inline-block">
                    ${Number(i.amount).toFixed(2)}
                  </span>
                  <button
                    onClick={() => setEditingIncomeId(i.id)}
                    className="text-muted-foreground/50 hover:text-primary transition-colors"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => handleDeleteIncome(i.id)}
                    className="text-muted-foreground/50 hover:text-destructive transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
            <form onSubmit={handleAddIncome} className="space-y-2 pt-2">
              <Input name="name" placeholder="Source name" required />
              <Input name="amount" type="number" step="0.01" placeholder="Amount" required />
              <select
                name="frequency"
                required
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                <option value="WEEKLY">Weekly</option>
                <option value="BIWEEKLY">Biweekly</option>
                <option value="SEMIMONTHLY">Semimonthly</option>
                <option value="MONTHLY">Monthly</option>
              </select>
              <Label htmlFor="nextPayDate" className="text-xs text-muted-foreground">
                Next pay date
              </Label>
              <Input name="nextPayDate" type="date" required />
              <Button type="submit" className="w-full font-semibold">
                Add Income
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-border/50 py-6">
          <CardHeader>
            <CardTitle>Bills</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleQuickSpend} className="rounded-md border border-dashed p-3 space-y-2 bg-muted/30">
              <p className="text-xs font-medium text-muted-foreground">Quick Spend — log something you already paid</p>
              <Input name="name" placeholder="What was it?" required />
              <Input name="amount" type="number" step="0.01" placeholder="Amount" required />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" name="isRecurring" />
                This is recurring — add it to my regular budgeted bills
              </label>
              <Button type="submit" size="sm" variant="outline" className="w-full font-semibold">
                Log Expense
              </Button>
            </form>

            {bills.map((b) => {
              const relevantGroupIds = [b.currentSplitGroupId, b.previousSplitGroupId].filter(Boolean);
              const splitLegs = b.payments.filter(
                (p) => p.isSplitPayment && relevantGroupIds.includes(p.splitGroupId)
              );
              const needsBillReview = needsReviewBillIds.has(b.id);
              const reviewItem = needsReview.find((n) => n.billId === b.id);

              return (
                <div key={b.id} className="border-b pb-2">
                  <div className="flex items-start justify-between gap-2 text-sm">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {b.hasActiveSplit ? (
                        <SplitSquareHorizontal size={16} className="text-primary shrink-0" />
                      ) : (
                        <button onClick={() => handleTogglePaid(b.id, b.paidThisMonth)}>
                          {b.paidThisMonth ? (
                            <CheckCircle2 size={16} className="text-primary" />
                          ) : (
                            <Circle size={16} className="text-muted-foreground/40" />
                          )}
                        </button>
                      )}
                      <div className="flex flex-col min-w-0">
                        <span
                          className={`font-medium flex items-center gap-1.5 ${
                            b.paidThisMonth ? "text-muted-foreground line-through" : ""
                          } ${(b.isOverdue || b.previousMonthUnpaid || !!b.previousSplitGroupId) ? "text-red-600 font-bold" : ""}`}
                        >
                          {b.name}
                          {b.hasActiveSplit && (
                            <SplitSquareHorizontal size={13} className="text-primary" />
                          )}
                          {b.hasLateSplit && <AlertTriangle size={13} className="text-yellow-600" />}
                          {(b.isOverdue || b.previousMonthUnpaid || !!b.previousSplitGroupId) && (
                            <AlertTriangle size={13} className="text-red-500" />
                          )}
                          {needsBillReview && (
                            <button
                              onClick={() =>
                                setReviewingBillId(reviewingBillId === b.id ? null : b.id)
                              }
                              title="This bill has an earlier occurrence that needs your confirmation"
                            >
                              <HelpCircle size={13} className="text-blue-500" />
                            </button>
                          )}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          {getCategoryIcon(b.category)}
                          Due {b.dueDate}
                          {b.category && ` · ${b.category}`}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {b.paidThisMonth && b.paidAmount != null && Number(b.paidAmount) !== Number(b.amount) ? (
                        (() => {
                          const paidMore = Number(b.paidAmount) > Number(b.amount);
                          const colorClass = paidMore ? "text-red-500" : "text-green-600";
                          return (
                            <span className="flex flex-col items-end min-w-[70px]">
                              <span className={`text-xs line-through ${colorClass}`}>
                                ${Number(b.amount).toFixed(2)}
                              </span>
                              <span className={`font-semibold ${colorClass}`}>
                                ${Number(b.paidAmount).toFixed(2)}
                              </span>
                            </span>
                          );
                        })()
                      ) : (
                        <span className="font-semibold min-w-[70px] text-right inline-block">
                          ${Number(b.amount).toFixed(2)}
                        </span>
                      )}
                      <button
                        onClick={() => setMenuBillId(b.id)}
                        className="text-muted-foreground/50 hover:text-primary transition-colors"
                        aria-label="Bill options"
                      >
                        <MoreVertical size={16} />
                      </button>
                    </div>
                  </div>

                  {reviewingBillId === b.id && reviewItem && (
                    <div className="ml-6 mt-1.5 rounded-md border border-blue-200 bg-blue-50 p-2 text-xs space-y-2">
                      <p>
                        Was {reviewItem.billName} paid for{" "}
                        {new Date(reviewItem.dueDate).toLocaleDateString(undefined, {
                          timeZone: "UTC",
                        })}
                        ?
                      </p>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => handleResolveNeedsReview(b.id, true)}
                        >
                          Paid
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => handleResolveNeedsReview(b.id, false)}
                        >
                          Not yet
                        </Button>
                      </div>
                    </div>
                  )}

                  {b.hasActiveSplit && splitLegs.length > 0 && (
                    <div className="ml-6 mt-1.5 space-y-1">
                      {splitLegs.map((leg) => {
                        const legPaid = leg.status === "PAID";
                        const legPaidDifferent =
                          legPaid &&
                          leg.paidAmount != null &&
                          Number(leg.paidAmount) !== Number(leg.amount);

                        return (
                          <div key={leg.id} className="flex items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-2">
                              <button onClick={() => handleToggleSplitPaymentPaid(leg.id, legPaid)}>
                                {legPaid ? (
                                  <CheckCircle2 size={14} className="text-primary" />
                                ) : (
                                  <Circle size={14} className="text-muted-foreground/40" />
                                )}
                              </button>
                              <span className={legPaid ? "text-muted-foreground line-through" : "text-muted-foreground"}>
                                {leg.paidDate &&
                                  new Date(leg.paidDate).toLocaleDateString(undefined, { timeZone: "UTC" })}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              {legPaidDifferent ? (
                                (() => {
                                  const paidMore = Number(leg.paidAmount) > Number(leg.amount);
                                  const colorClass = paidMore ? "text-red-500" : "text-green-600";
                                  return (
                                    <span className="flex flex-col items-end">
                                      <span className={`line-through ${colorClass}`}>
                                        ${Number(leg.amount).toFixed(2)}
                                      </span>
                                      <span className={`font-medium ${colorClass}`}>
                                        ${Number(leg.paidAmount).toFixed(2)}
                                      </span>
                                    </span>
                                  );
                                })()
                              ) : (
                                <span className="font-medium">${Number(leg.amount).toFixed(2)}</span>
                              )}
                              <button
                                onClick={() => setPayingLegId(leg.id)}
                                className="text-muted-foreground/50 hover:text-primary transition-colors"
                                aria-label="Edit paid amount"
                              >
                                <Pencil size={12} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            <form onSubmit={handleAddBill} className="space-y-2 pt-2">
              <Input
                name="name"
                placeholder="Bill name"
                required
                onChange={(e) => {
                  const suggestion = suggestCategory(e.target.value);
                  const categoryInput = e.currentTarget.form?.elements.namedItem(
                    "category"
                  ) as HTMLInputElement;
                  if (suggestion && categoryInput && !categoryInput.dataset.userEdited) {
                    categoryInput.value = suggestion;
                  }
                }}
              />
              <Input name="amount" type="number" step="0.01" placeholder="Amount" required />
              <div>
                <Label className="text-xs text-muted-foreground">Due date</Label>
                <DayOfMonthPicker name="dueDate" />
              </div>
              <Input
                name="category"
                placeholder="Category (auto-suggested as you type)"
                onChange={(e) => {
                  e.currentTarget.dataset.userEdited = "true";
                }}
              />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="splittable" />
                Splittable into two payments
              </label>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">When is this paid?</Label>
                <select
                  name="fundingModel"
                  defaultValue="BEFORE_DUE"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                >
                  <option value="BEFORE_DUE">Paid on time, before it's due</option>
                  <option value="NEXT_CHECK">Paid from my next paycheck, even if that's a few days late</option>
                </select>
              </div>
              <Button type="submit" className="w-full font-semibold">
                Add Bill
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {dueModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setDueModalOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg border bg-background p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg">Due Before Next Payday</h2>
              <button
                onClick={() => setDueModalOpen(false)}
                className="text-muted-foreground/60 hover:text-foreground transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="space-y-2">
              {currentPeriod?.bills.map((item: any, i: number) => (
                <div key={`period-${i}`} className="flex items-center justify-between text-sm border-b pb-2">
                  <span className="font-medium">{item.bill.name}</span>
                  <span className="font-semibold">${item.bill.amount.toFixed(2)}</span>
                </div>
              ))}
              {needsReview.map((n) => (
                <div key={`review-${n.billId}`} className="flex items-center justify-between text-sm border-b pb-2">
                  <span className="font-medium flex items-center gap-1">
                    <HelpCircle size={13} className="text-blue-500" />
                    {n.billName}
                  </span>
                  <span className="font-semibold">${n.amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-full mt-4"
              onClick={() => setDueModalOpen(false)}
            >
              Close
            </Button>
          </div>
        </div>
      )}

      {pastDueModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setPastDueModalOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg border bg-background p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg">Bills Past Due</h2>
              <button
                onClick={() => setPastDueModalOpen(false)}
                className="text-muted-foreground/60 hover:text-foreground transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="space-y-2">
              {bills
                .filter((b) => b.isOverdue || b.previousMonthUnpaid || !!b.previousSplitGroupId)
                .map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between text-sm border-b pb-2"
                  >
                    <span className="font-medium">{b.name}</span>
                    <span className="font-semibold">${Number(b.amount).toFixed(2)}</span>
                  </div>
                ))}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-full mt-4"
              onClick={() => setPastDueModalOpen(false)}
            >
              Close
            </Button>
          </div>
        </div>
      )}

      {editingBill && (
        <EditBillModal
          bill={editingBill}
          onClose={() => setEditingBillId(null)}
          onSave={(updates) => handleUpdateBill(editingBill.id, updates)}
        />
      )}

      {editingIncome && (
        <EditIncomeModal
          income={editingIncome}
          onClose={() => setEditingIncomeId(null)}
          onSave={(updates) => handleUpdateIncome(editingIncome.id, updates)}
        />
      )}

      {menuBill && (
        <PayBillMenu
          bill={menuBill}
          onClose={() => setMenuBillId(null)}
          onEdit={() => {
            setMenuBillId(null);
            setEditingBillId(menuBill.id);
          }}
          onQuickTogglePaid={() => {
            setMenuBillId(null);
            handleTogglePaid(menuBill.id, menuBill.paidThisMonth);
          }}
          onMarkPaidAmount={(amount) => handleMarkPaidAmount(menuBill.id, amount)}
          onDelete={() => handleDeleteBill(menuBill.id)}
        />
      )}

      {payingLeg && (
        <SplitLegPayModal
          leg={payingLeg}
          onClose={() => setPayingLegId(null)}
          onConfirm={(paymentId, amount) => {
            handleMarkSplitLegPaidAmount(paymentId, amount);
          }}
        />
      )}

      {monthlyReviewOpen && (
        <MonthlyReviewModal
          bills={monthlyReviewBills}
          onResolve={handleMonthlyReviewResolve}
          onClose={handleMonthlyReviewClose}
        />
      )}
    </main>
  );
}

function EditAmountForm({
  initialValue,
  onSave,
  onCancel,
}: {
  initialValue: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);

  return (
    <div className="flex items-center gap-1">
      <Input
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-7 w-24 text-sm"
        autoFocus
      />
      <button onClick={() => onSave(value)} className="text-primary hover:opacity-80">
        <Check size={16} />
      </button>
      <button onClick={onCancel} className="text-muted-foreground/50 hover:text-foreground">
        <X size={16} />
      </button>
    </div>
  );
}

function getCategoryIcon(category: string | null) {
  const map: Record<string, typeof Tag> = {
    housing: Home,
    "car loan": Car,
    "car insurance": Car,
    electric: Zap,
    water: Droplet,
    gas: Flame,
    internet: Wifi,
    phone: Phone,
    subscription: Tv,
    "health/medical": HeartPulse,
    "credit card": CreditCard,
  };
  const Icon = category ? map[category.toLowerCase()] ?? Tag : Tag;
  return <Icon size={14} className="text-muted-foreground/60" />;
}