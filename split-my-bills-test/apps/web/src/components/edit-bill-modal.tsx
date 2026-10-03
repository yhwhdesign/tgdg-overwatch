"use client";

import { useState } from "react";
import { DayOfMonthPicker } from "@/components/day-of-month-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";

type EditableBill = {
  id: string;
  name: string;
  amount: string;
  dueDate: number;
  category: string | null;
  splittable: boolean;
  fundingModel: "BEFORE_DUE" | "NEXT_CHECK";
};

export function EditBillModal({
  bill,
  onSave,
  onClose,
}: {
  bill: EditableBill;
  onSave: (updates: {
    name: string;
    amount: number;
    dueDate: number;
    category: string;
    splittable: boolean;
    fundingModel: string;
  }) => void;
  onClose: () => void;
}) {
  // Only splittable is tracked in React state here — it drives the warning banner below,
  // which needs to react live as the user toggles it. Everything else is read from
  // FormData on submit, same pattern as the add-bill form (DayOfMonthPicker only
  // supports that uncontrolled pattern, so the rest of the form matches it for consistency).
  const [splittable, setSplittable] = useState(bill.splittable);
  const [dueDateChanged, setDueDateChanged] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    onSave({
      name: formData.get("name") as string,
      amount: Number(formData.get("amount")),
      dueDate: Number(formData.get("dueDate")),
      category: (formData.get("category") as string) ?? "",
      splittable: formData.get("splittable") === "on",
      fundingModel: formData.get("fundingModel") as string,
    });
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
          <h2 className="font-semibold text-lg">Edit Bill</h2>
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
            <Label className="text-xs text-muted-foreground">Bill name</Label>
            <Input name="name" defaultValue={bill.name} required />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Amount</Label>
            <Input
              name="amount"
              type="number"
              step="0.01"
              defaultValue={bill.amount}
              required
            />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Due date</Label>
            <div
              onClickCapture={() => {
                // Fires whenever a day is clicked inside the picker — used only to
                // flag "the user touched this" so the warning banner can appear.
                // The actual selected value is read from FormData on submit.
                setDueDateChanged(true);
              }}
            >
              <DayOfMonthPicker name="dueDate" defaultValue={bill.dueDate} />
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Category</Label>
            <Input name="category" defaultValue={bill.category ?? ""} />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="splittable"
              checked={splittable}
              onChange={(e) => setSplittable(e.target.checked)}
            />
            Splittable into two payments
          </label>

          <div>
            <Label className="text-xs text-muted-foreground">When is this paid?</Label>
            <select
              name="fundingModel"
              defaultValue={bill.fundingModel}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            >
              <option value="BEFORE_DUE">Paid on time, before it's due</option>
<option value="NEXT_CHECK">Paid from my next paycheck, even if that's a few days late</option>
            </select>
          </div>

          {(splittable !== bill.splittable || dueDateChanged) && (
            <p className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-md p-2">
              Changing the due date or splittable status will reset this bill's split payment
              schedule. Any already-paid payments are kept.
            </p>
          )}

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