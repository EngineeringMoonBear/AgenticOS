import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type PillVariant = "ok" | "warn" | "err" | "run" | "stuck";

export interface PillProps {
  variant: PillVariant;
  children: ReactNode;
  showDot?: boolean;
  className?: string;
}

export function Pill({
  variant,
  children,
  showDot = true,
  className,
}: PillProps) {
  return (
    <span className={cn("pill", variant, className)}>
      {showDot && <span className="dot" />}
      {children}
    </span>
  );
}
