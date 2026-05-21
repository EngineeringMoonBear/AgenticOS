"use client";
import { useAgentHealth } from "@/lib/hooks/use-agent-health";

export function AgentStatusChip() {
  const { data } = useAgentHealth();
  const online = data?.status === "ok";
  const dotColor = online ? "var(--lane-hermes, #4db6ac)" : "var(--text-muted, #6b6157)";
  const latency = data?.honcho?.latencyMs;
  const label = online
    ? `Agent online · Honcho ${latency ?? "?"}ms`
    : "Agent degraded — check Honcho connection";
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
      AGENT
    </span>
  );
}
