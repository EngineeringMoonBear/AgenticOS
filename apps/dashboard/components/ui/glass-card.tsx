import type { HTMLAttributes } from "react"

import { cn } from "@/lib/utils"

type GlassCardVariant = "default" | "kpi" | "row"

export interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: GlassCardVariant
}

const variantClasses: Record<GlassCardVariant, string> = {
  default: "p-4",
  kpi: "p-6",
  row: "px-4 py-3",
}

function GlassCard({
  className,
  variant = "default",
  ...props
}: GlassCardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.30)]",
        variantClasses[variant],
        className
      )}
      {...props}
    />
  )
}

export { GlassCard }
