import { PiggyBank } from "lucide-react";

export function Logo({ size = "default" }: { size?: "default" | "large" }) {
  const iconSize = size === "large" ? 32 : 22;
  const textSize = size === "large" ? "text-2xl" : "text-lg";

  return (
    <div className="flex items-center gap-2">
      <div className="rounded-lg bg-primary/10 p-1.5">
        <PiggyBank size={iconSize} className="text-primary" strokeWidth={2.25} />
      </div>
      <span className={`${textSize} font-bold tracking-tight`}>
        Split<span className="text-primary">MyBills</span>
      </span>
    </div>
  );
}