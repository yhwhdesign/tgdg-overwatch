"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { X, CheckCircle2, Circle } from "lucide-react";

type ReviewBill = { id: string; name: string; amount: string; occurrenceDate: string };

export function MonthlyReviewModal({
  bills,
  onResolve,
  onClose,
}: {
  bills: ReviewBill[];
  onResolve: (billId: string, wasPaid: boolean, occurrenceDate: string) => void;
  onClose: (allResolved: boolean) => void;
}) {
  const [index, setIndex] = useState(0);
  const [allPaidSoFar, setAllPaidSoFar] = useState(true);
  const current = bills[index];

  function handleAnswer(wasPaid: boolean) {
    onResolve(current.id, wasPaid, current.occurrenceDate);
    const stillAllPaid = allPaidSoFar && wasPaid;
    setAllPaidSoFar(stillAllPaid);
    if (index + 1 < bills.length) {
      setIndex(index + 1);
    } else {
      onClose(stillAllPaid);
    }
  }

  if (!current) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-2xl border bg-background p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-medium text-muted-foreground">
            New month check-in — {index + 1} of {bills.length}
          </span>
          <button
            onClick={() => onClose(false)}
            className="text-muted-foreground/60 hover:text-foreground"
          >
            <X size={18} />
          </button>
        </div>

        <div className="rounded-xl border bg-muted/30 p-5 text-center space-y-1 mb-5">
          <p className="text-sm text-muted-foreground">Was this paid?</p>
          <p className="text-lg font-semibold">{current.name}</p>
          <p className="text-2xl font-bold text-primary">${Number(current.amount).toFixed(2)}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" className="h-12" onClick={() => handleAnswer(false)}>
            <Circle size={16} className="mr-2" /> Not yet
          </Button>
          <Button className="h-12" onClick={() => handleAnswer(true)}>
            <CheckCircle2 size={16} className="mr-2" /> Paid
          </Button>
        </div>

        <div className="flex justify-center gap-1 mt-5">
          {bills.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 w-1.5 rounded-full ${i === index ? "bg-primary" : "bg-muted"}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}