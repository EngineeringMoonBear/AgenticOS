"use client";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type IconBtnVariant = "default" | "alert" | "go";

export interface IconBtnProps {
  variant?: IconBtnVariant;
  ariaLabel: string;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  children: ReactNode;
}

export function IconBtn({
  variant = "default",
  ariaLabel,
  onClick,
  className,
  type = "button",
  disabled,
  children,
}: IconBtnProps) {
  return (
    <button
      type={type}
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "icon-btn",
        variant === "alert" && "alert",
        variant === "go" && "go",
        className,
      )}
    >
      {children}
    </button>
  );
}
