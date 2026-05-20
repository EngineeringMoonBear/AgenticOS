"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRunFeed } from "@/lib/hooks/use-run-feed";

function formatElapsed(ms: number | undefined): string {
  if (ms === undefined) return "—";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

export function LiveRunsStrip() {
  const { data: runs } = useRunFeed({ status: "running" });
  const liveRuns = (runs ?? []).slice(0, 3);

  if (liveRuns.length === 0) return null;

  return (
    <div
      className="flex items-center gap-2 px-4 py-2 overflow-x-auto shrink-0"
      style={{
        borderBottom: "1px solid var(--border-subtle)",
        background: "var(--bg)",
      }}
    >
      <span
        className="text-[11px] font-semibold uppercase tracking-widest shrink-0"
        style={{ color: "var(--text-muted)" }}
      >
        Live
      </span>

      {liveRuns.map((run) => (
        <Link
          key={run.id}
          href={`/observability/run/${run.id}`}
          className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium shrink-0 transition-colors"
          style={{
            background: "var(--info-bg)",
            border: "1px solid var(--info-border)",
            color: "var(--info)",
          }}
        >
          <RefreshCw size={12} strokeWidth={1.5} style={{ color: "var(--lane-hermes)" }} />
          <span style={{ color: "var(--text-secondary)" }}>{run.skillId}</span>
          <span style={{ color: "var(--text-muted)" }}>
            {formatElapsed(run.durationMs)}
          </span>
          <span style={{ color: "var(--text-muted)" }}>▸</span>
        </Link>
      ))}
    </div>
  );
}
