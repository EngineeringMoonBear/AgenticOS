"use client";
import { useCostBurn } from "@/lib/hooks/use-cost-burn";

function tier(pct: number): string {
  if (pct >= 100) return "bg-red-500/20 text-red-100 border-red-500/40";
  if (pct >= 80) return "bg-amber-500/20 text-amber-100 border-amber-500/40";
  return "bg-emerald-500/20 text-emerald-100 border-emerald-500/40";
}

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

export function CostBurnChip() {
  const { data, isError } = useCostBurn();
  if (isError) return <Chip>—</Chip>;
  if (!data) return <Chip>…</Chip>;
  return (
    <Chip
      className={tier(data.pct_of_cap)}
      title={`Today ${dollars(data.today_cents)} · MTD ${dollars(data.mtd_cents)} of ${dollars(data.cap_cents)} (${data.pct_of_cap}%)`}
    >
      {dollars(data.today_cents)} today · {data.pct_of_cap}% cap
    </Chip>
  );
}

function Chip({
  children,
  className = "",
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-xs border ${className}`}
      title={title}
    >
      {children}
    </span>
  );
}
