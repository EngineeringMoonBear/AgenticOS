import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface RowProps {
  stuck?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function Row({ stuck, className, style, children }: RowProps) {
  return (
    <div className={cn("row", stuck && "stuck", className)} style={style}>
      {children}
    </div>
  );
}

export interface RowListProps {
  className?: string;
  children: ReactNode;
}

export function RowList({ className, children }: RowListProps) {
  return <div className={cn("row-list", className)}>{children}</div>;
}
