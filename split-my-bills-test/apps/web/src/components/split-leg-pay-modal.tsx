"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";

type MenuLeg = {
  id: string;
  amount: string;
  paidAmount: string | null;
};

export function SplitLegPayModal({
  leg,
  onClose,
  onConfirm,
}: {
  leg: MenuLeg;
  onClose: () => void;
  onConfirm: (paymentId: string, amount: number) => void;
}) {
  const [amount, setAmount] = useState(leg.paidAmount ?? leg.amount);

  const numericAmount = Number(amount) || 0;
  const original = Number(leg.amount);
  const diff = numericAmount - original;
  const colorClass =
    diff > 0 ? "text-red-500" : diff < 0 ? "text-green-600" : "text-foreground";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onConfirm(leg.id, numericAmount);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg border bg-background p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-lg">Mark Split Payment Paid</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground/60 hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">Amount actually paid</Label>
            <Input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
              required
            />
            <p className="text-xs text-muted-foreground mt-1">
              Planned: ${original.toFixed(2)}
            </p>
            {diff !== 0 && (
              <p className={`text-sm font-semibold mt-1 ${colorClass}`}>
                ${numericAmount.toFixed(2)} ({diff > 0 ? "+" : ""}
                {diff.toFixed(2)} vs. planned)
              </p>
            )}
          </div>
          <div className="flex gap-2 pt-1">
            <Button type="submit" className="flex-1 font-semibold">
              Confirm Paid
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}