"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pencil, CheckCircle2, Circle, Trash2, X } from "lucide-react";

type MenuBill = {
  id: string;
  name: string;
  amount: string;
  paidThisMonth: boolean;
};

type View = "menu" | "updateAmount" | "confirmDelete";

export function PayBillMenu({
  bill,
  onClose,
  onEdit,
  onQuickTogglePaid,
  onMarkPaidAmount,
  onDelete,
}: {
  bill: MenuBill;
  onClose: () => void;
  onEdit: () => void;
  onQuickTogglePaid: () => void;
  onMarkPaidAmount: (amount: number) => void;
  onDelete: () => void;
}) {
  const [view, setView] = useState<View>("menu");
  const [amount, setAmount] = useState(bill.amount);

  function handleUpdateAmountSubmit(e: React.FormEvent) {
    e.preventDefault();
    onMarkPaidAmount(Number(amount));
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
          <h2 className="font-semibold text-lg truncate pr-2">{bill.name}</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground/60 hover:text-foreground transition-colors shrink-0"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {view === "menu" && (
          <div className="space-y-2">
            <button
              onClick={onEdit}
              className="flex w-full items-center gap-3 rounded-md border p-3 text-sm hover:bg-muted transition-colors text-left"
            >
              <Pencil size={16} className="text-muted-foreground" />
              Edit Bill
            </button>
            <button
              onClick={onQuickTogglePaid}
              className="flex w-full items-center gap-3 rounded-md border p-3 text-sm hover:bg-muted transition-colors text-left"
            >
              {bill.paidThisMonth ? (
                <CheckCircle2 size={16} className="text-primary" />
              ) : (
                <Circle size={16} className="text-muted-foreground" />
              )}
              {bill.paidThisMonth
                ? "Mark Unpaid"
                : `Confirm Paid ($${Number(bill.amount).toFixed(2)})`}
            </button>
            <button
              onClick={() => setView("updateAmount")}
              className="flex w-full items-center gap-3 rounded-md border p-3 text-sm hover:bg-muted transition-colors text-left"
            >
              <Pencil size={16} className="text-primary" />
              {bill.paidThisMonth ? "Update Paid Amount" : "Mark Paid — Different Amount"}
            </button>
            <button
              onClick={() => setView("confirmDelete")}
              className="flex w-full items-center gap-3 rounded-md border p-3 text-sm hover:bg-destructive/5 hover:border-destructive/30 transition-colors text-left text-destructive"
            >
              <Trash2 size={16} />
              Delete Bill
            </button>
          </div>
        )}

        {view === "updateAmount" && (
          <form onSubmit={handleUpdateAmountSubmit} className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">
                Amount actually paid
              </Label>
              <Input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
                required
              />
              <p className="text-xs text-muted-foreground mt-1">
                Budgeted: ${Number(bill.amount).toFixed(2)}
              </p>
            </div>
            <div className="flex gap-2 pt-1">
              <Button type="submit" className="flex-1 font-semibold">
                Confirm
              </Button>
              <Button type="button" variant="outline" onClick={() => setView("menu")}>
                Back
              </Button>
            </div>
          </form>
        )}

        {view === "confirmDelete" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Delete <span className="font-medium text-foreground">{bill.name}</span>? This
              can&apos;t be undone.
            </p>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                className="flex-1 font-semibold"
                onClick={onDelete}
              >
                Delete
              </Button>
              <Button variant="outline" onClick={() => setView("menu")}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}