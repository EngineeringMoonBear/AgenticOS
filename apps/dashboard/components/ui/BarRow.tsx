import { cn } from "@/lib/utils";

export interface BarRowProps {
  name: string;
  scope?: string;
  fillPercent: number;
  count: number | string;
  className?: string;
}

function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

export function BarRow({
  name,
  scope,
  fillPercent,
  count,
  className,
}: BarRowProps) {
  const pct = clampPercent(fillPercent);
  return (
    <div className={cn("bar-row", className)}>
      <div>
        <div className="name">{name}</div>
        {scope ? <div className="scope">{scope}</div> : null}
      </div>
      <div className="track">
        <div className="fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="count">{count}</div>
    </div>
  );
}
