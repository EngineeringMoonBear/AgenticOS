"use client";

import { RefreshCw, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";
import type { RunRecord } from "@/lib/agent";
import { useRunVitalSigns } from "@/lib/hooks/use-run-vital-signs";
import { cn } from "@/lib/utils";

// Run-card view-model — RunRecord plus optional UI metadata (tags, model, durationMs)
// not yet captured in the canonical RunRecord schema.
type Run = RunRecord & {
  skillId?: string;
  tags?: string[];
  model?: string;
  durationMs?: number;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "—";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function formatCost(cost: number | undefined): string {
  if (cost === undefined) return "—";
  return `$${cost.toFixed(2)}`;
}

// ── Status chip ───────────────────────────────────────────────────────────────

function StatusChip({
  run,
  vitals,
  nowMs,
}: {
  run: Run;
  vitals: ReturnType<typeof useRunVitalSigns>;
  nowMs: number;
}) {
  if (vitals?.throttledUntil) {
    const mins = Math.max(
      0,
      Math.floor(
        (new Date(vitals.throttledUntil).getTime() - nowMs) / 60_000
      )
    );
    return (
      <span
        className="shrink-0 rounded-sm px-1.5 py-px text-[11px] font-medium tracking-wide uppercase"
        style={{
          background: "var(--warning-bg, #3a2e1c)",
          color: "var(--accent-gold-400, #c9a227)",
        }}
      >
        THROTTLED · {mins}m
      </span>
    );
  }
  if (vitals?.isStale) {
    return (
      <span
        className="shrink-0 rounded-sm px-1.5 py-px text-[11px] font-medium tracking-wide uppercase"
        style={{
          background: "var(--warning-bg, #3a2e1c)",
          color: "var(--accent-gold-400, #c9a227)",
        }}
      >
        STALE
      </span>
    );
  }

  const statusStyles: Record<
    string,
    { bg: string; border: string; color: string }
  > = {
    running: {
      bg: "var(--info-bg)",
      border: "var(--info-border)",
      color: "var(--info)",
    },
    completed: {
      bg: "var(--success-bg)",
      border: "var(--success-border)",
      color: "var(--success)",
    },
    failed: {
      bg: "var(--error-bg)",
      border: "var(--error-border)",
      color: "var(--error)",
    },
    canceled: {
      bg: "var(--surface-muted)",
      border: "var(--border-subtle)",
      color: "var(--text-muted)",
    },
    queued: {
      bg: "var(--warning-bg)",
      border: "var(--warning-border)",
      color: "var(--warning)",
    },
  };

  const style = statusStyles[run.status] ?? statusStyles["queued"]!;
  return (
    <span
      className="shrink-0 rounded-sm px-1.5 py-px text-[11px] font-medium tracking-wide uppercase"
      style={{
        background: style.bg,
        border: `1px solid ${style.border}`,
        color: style.color,
      }}
    >
      {run.status}
    </span>
  );
}

// ── RunCard ───────────────────────────────────────────────────────────────────

interface RunCardProps {
  run: Run;
}

export function RunCard({ run }: RunCardProps) {
  const vitals = useRunVitalSigns(run);
  const [nowMs, setNowMs] = useState(() => new Date().getTime());
  const isRunning = run.status === "running";
  const stale = vitals?.isStale ?? false;
  const throttled = !!vitals?.throttledUntil;

  // Keep nowMs current when there's a throttle timer showing
  useEffect(() => {
    if (!throttled) return;
    const interval = setInterval(() => setNowMs(new Date().getTime()), 30_000);
    return () => clearInterval(interval);
  }, [throttled]);

  const stripeColor =
    stale || throttled
      ? "var(--accent-gold-400, #c9a227)"
      : "var(--lane-hermes, #4db6ac)";
  const pulseDuration = stale || throttled ? "4s" : "2s";

  return (
    <article
      className="run-card group flex overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.30)]"
    >
      {/* Lane stripe — 2px, pulses when running */}
      <div
        className={cn("run-card__stripe shrink-0 w-0.5", {
          "run-stripe-pulse": isRunning,
        })}
        style={{
          backgroundColor: stripeColor,
          animationDuration: isRunning ? pulseDuration : undefined,
        }}
        aria-hidden
      />

      {/* Card body */}
      <div className="flex flex-col gap-2 px-4 py-3 flex-1 min-w-0">
        {/* Header row */}
        <div className="flex items-start gap-2">
          {/* Lane icon + skill id */}
          <RefreshCw
            className="mt-0.5 shrink-0"
            size={16}
            strokeWidth={1.5}
            style={{ color: "var(--lane-hermes)" }}
            aria-label="Hermes lane"
          />
          <span
            className="flex-1 min-w-0 truncate text-sm font-medium leading-5"
            style={{ color: "var(--text)" }}
          >
            {run.skillId ?? run.agent}
          </span>

          {/* Tags */}
          <div className="flex items-center gap-1 shrink-0">
            {(run.tags ?? []).map((tag: string) => (
              <span
                key={tag}
                className="rounded-sm px-1.5 py-px text-[11px] font-medium tracking-wide"
                style={{
                  background: "var(--surface-muted)",
                  color: "var(--text-muted)",
                }}
              >
                #{tag}
              </span>
            ))}
          </div>

          {/* Status chip */}
          <StatusChip run={run} vitals={vitals} nowMs={nowMs} />
        </div>

        {/* Meta row */}
        <div
          className="flex items-center gap-2 text-[12px]"
          style={{ color: "var(--text-muted)" }}
        >
          <span
            className="font-mono"
            style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
          >
            {formatDuration(run.durationMs)}
          </span>
          <span aria-hidden>·</span>
          <span
            className="rounded-sm px-1.5 py-px"
            style={{
              background: "var(--surface-muted)",
              color: "var(--text-muted)",
              fontFamily: "var(--font-jetbrains-mono, monospace)",
              fontSize: "11px",
            }}
          >
            {run.model}
          </span>
          <span aria-hidden>·</span>
          <span
            style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
          >
            {isRunning ? "~" : ""}
            {formatCost(run.costUsd)}
          </span>
          <span aria-hidden>·</span>
          <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
            {run.inputTokens + run.outputTokens} tok
          </span>
        </div>

        {/* Actions row */}
        <div className="flex items-center gap-2">
          {isRunning ? (
            <button
              type="button"
              className="rounded-md px-2.5 py-1 text-xs font-medium border transition-colors"
              style={{
                borderColor: "var(--error-border)",
                color: "var(--error)",
                background: "var(--error-bg)",
              }}
              onClick={() => {}}
            >
              Cancel
            </button>
          ) : null}

          <Link
            href={`/observability/run/${run.id}`}
            className="rounded-md px-2.5 py-1 text-xs font-medium border transition-colors"
            style={{
              borderColor: "var(--border-brand)",
              color: "var(--text-secondary)",
              background: "transparent",
            }}
          >
            View
          </Link>

          {/* Kebab */}
          <button
            type="button"
            className="ml-auto rounded-md p-1 transition-colors opacity-0 group-hover:opacity-100"
            style={{ color: "var(--text-muted)" }}
            aria-label="More options"
            onClick={() => {}}
          >
            <MoreHorizontal size={14} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </article>
  );
}
