"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";

type EditableIncome = {
  id: string;
  name: string;
  amount: string;
  frequency: string;
  nextPayDate: string;
};

export function EditIncomeModal({
  income,
  onSave,
  onClose,
}: {
  income: EditableIncome;
  onSave: (updates: {
    name: string;
    amount: number;
    frequency: string;
    nextPayDate: string;
  }) => void;
  onClose: () => void;
}) {
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    onSave({
      name: formData.get("name") as string,
      amount: Number(formData.get("amount")),
      frequency: formData.get("frequency") as string,
      nextPayDate: formData.get("nextPayDate") as string,
    });
  }

  // Format the stored ISO date back into yyyy-MM-dd for the date input's
  // defaultValue — <input type="date"> requires that exact format.
  const nextPayDateValue = income.nextPayDate ? income.nextPayDate.slice(0, 10) : "";

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
          <h2 className="font-semibold text-lg">Edit Income Source</h2>
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
            <Label className="text-xs text-muted-foreground">Source name</Label>
            <Input name="name" defaultValue={income.name} required />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Amount</Label>
            <Input
              name="amount"
              type="number"
              step="0.01"
              defaultValue={income.amount}
              required
            />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Frequency</Label>
            <select
              name="frequency"
              defaultValue={income.frequency}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            >
              <option value="WEEKLY">Weekly</option>
              <option value="BIWEEKLY">Biweekly</option>
              <option value="SEMIMONTHLY">Semimonthly</option>
              <option value="MONTHLY">Monthly</option>
            </select>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Next pay date</Label>
            <Input name="nextPayDate" type="date" defaultValue={nextPayDateValue} required />
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="submit" className="flex-1 font-semibold">
              Save Changes
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