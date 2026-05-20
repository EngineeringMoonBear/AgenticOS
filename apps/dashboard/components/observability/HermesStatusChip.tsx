"use client";
import { useHermesHealth } from "@/lib/hooks/use-hermes-health";

export function HermesStatusChip() {
  const { data } = useHermesHealth();
  const online = data?.status === "ok" || data?.status === "degraded";
  const dotColor = online ? "var(--lane-hermes, #4db6ac)" : "var(--text-muted, #6b6157)";
  const label = online
    ? `Hermes v${data!.version} · ${data!.activeRuns} active`
    : "Hermes offline — run `hermes serve` to start";
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs rounded-sm"
      title={label}
      style={{ color: "var(--text-muted)" }}
    >
      <span
        className="inline-block w-2 h-2 rounded-full"
        style={{ background: dotColor }}
        aria-hidden
      />
      HERMES
    </span>
  );
}
