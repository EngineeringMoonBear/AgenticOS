import { cn } from "@/lib/utils";

export type ProgressVariant = "pine" | "amber" | "gold";

export interface ProgressProps {
  name: string;
  count: string;
  percent: number;
  variant: ProgressVariant;
  className?: string;
}

function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

export function Progress({
  name,
  count,
  percent,
  variant,
  className,
}: ProgressProps) {
  const pct = clampPercent(percent);
  return (
    <div className={cn("progress", className)}>
      <div className="progress-head">
        <span className="pname">{name}</span>
        <span className="pcount">{count}</span>
      </div>
      <div className="progress-track">
        <div
          className={cn("progress-fill", variant)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
