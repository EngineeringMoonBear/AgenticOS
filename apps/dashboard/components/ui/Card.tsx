import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type CardLane = "gold" | "pine" | "amber" | "russet";

export interface CardProps {
  lane?: CardLane;
  spanFull?: boolean;
  span2?: boolean;
  className?: string;
  children: ReactNode;
}

export interface CardHeadProps {
  className?: string;
  children: ReactNode;
}

export interface CardTitleProps {
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

export interface CardActionProps {
  className?: string;
  children: ReactNode;
}

function CardRoot({ lane, spanFull, span2, className, children }: CardProps) {
  return (
    <div
      className={cn(
        "card",
        lane && `lane--${lane}`,
        spanFull && "span-full",
        span2 && "span-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHead({ className, children }: CardHeadProps) {
  return <div className={cn("card-head", className)}>{children}</div>;
}

export function CardTitle({ icon, className, children }: CardTitleProps) {
  return (
    <div className={cn("card-title", className)}>
      {icon}
      <span>{children}</span>
    </div>
  );
}

export function CardAction({ className, children }: CardActionProps) {
  return <span className={cn("card-action", className)}>{children}</span>;
}

export const Card = Object.assign(CardRoot, {
  Head: CardHead,
  Title: CardTitle,
  Action: CardAction,
});
