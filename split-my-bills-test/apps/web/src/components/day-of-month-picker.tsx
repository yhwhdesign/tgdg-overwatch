"use client";

import { useState } from "react";
//import { Button } from "@/components/ui/button";

export function DayOfMonthPicker({
  name,
  defaultValue,
}: {
  name: string;
  defaultValue?: number;
}) {
  const [selected, setSelected] = useState<number | null>(defaultValue ?? null);
  const days = Array.from({ length: 31 }, (_, i) => i + 1);

  return (
    <div>
      <input type="hidden" name={name} value={selected ?? ""} required />
      <div className="grid grid-cols-7 gap-1 rounded-md border border-input p-2">
        {days.map((day) => (
          <button
            key={day}
            type="button"
            onClick={() => setSelected(day)}
            className={`h-7 w-7 rounded-md text-xs transition-colors ${
              selected === day
                ? "bg-primary text-primary-foreground font-semibold"
                : "hover:bg-muted text-muted-foreground"
            }`}
          >
            {day}
          </button>
        ))}
      </div>
      {selected && (
        <p className="text-xs text-muted-foreground mt-1">
          Due on the {selected}
          {selected === 1 || selected === 21 || selected === 31
            ? "st"
            : selected === 2 || selected === 22
            ? "nd"
            : selected === 3 || selected === 23
            ? "rd"
            : "th"}{" "}
          of each month
        </p>
      )}
    </div>
  );
}