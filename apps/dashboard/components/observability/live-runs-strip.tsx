"use client";

import { RefreshCw, Container } from "lucide-react";
import Link from "next/link";
import type { Run } from "@/lib/fixtures/runs";

interface LiveRunsStripProps {
  runs: Run[];
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function LiveRunsStrip({ runs }: LiveRunsStripProps) {
  const liveRuns = runs.filter((r) => r.status === "running").slice(0, 3);

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

      {liveRuns.map((run) => {
        const laneColor =
          run.lane === "hermes"
            ? "var(--lane-hermes)"
            : "var(--lane-sandcastle)";
        const LaneIcon = run.lane === "hermes" ? RefreshCw : Container;

        return (
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
            <LaneIcon size={12} strokeWidth={1.5} style={{ color: laneColor }} />
            <span style={{ color: "var(--text-secondary)" }}>{run.title}</span>
            <span style={{ color: "var(--text-muted)" }}>
              {formatElapsed(run.durationSeconds)}
            </span>
            <span style={{ color: "var(--text-muted)" }}>▸</span>
          </Link>
        );
      })}
    </div>
  );
}
