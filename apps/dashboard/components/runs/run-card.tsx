"use client";

import { RefreshCw, Container, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import type { Run } from "@/lib/fixtures/runs";
import { cn } from "@/lib/utils";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function modelLabel(model: Run["model"]): string {
  const map: Record<Run["model"], string> = {
    haiku: "claude-haiku-4-5",
    sonnet: "claude-sonnet-4-6",
    opus: "claude-opus-4-5",
  };
  return map[model];
}

// ── Status pill ───────────────────────────────────────────────────────────────

const STATUS_MAP: Record<
  Run["status"],
  { label: string; style: React.CSSProperties }
> = {
  running: {
    label: "RUNNING",
    style: {
      background: "var(--info-bg)",
      border: "1px solid var(--info-border)",
      color: "var(--info)",
    },
  },
  done: {
    label: "DONE",
    style: {
      background: "var(--success-bg)",
      border: "1px solid var(--success-border)",
      color: "var(--success)",
    },
  },
  failed: {
    label: "FAILED",
    style: {
      background: "var(--error-bg)",
      border: "1px solid var(--error-border)",
      color: "var(--error)",
    },
  },
  "awaiting-approval": {
    label: "AWAITING APPROVAL",
    style: {
      background: "var(--warning-bg)",
      border: "1px solid var(--warning-border)",
      color: "var(--warning)",
    },
  },
};

// ── RunCard ───────────────────────────────────────────────────────────────────

interface RunCardProps {
  run: Run;
}

export function RunCard({ run }: RunCardProps) {
  const isRunning = run.status === "running";
  const laneColor =
    run.lane === "hermes" ? "var(--lane-hermes)" : "var(--lane-sandcastle)";
  const { label: statusLabel, style: statusStyle } = STATUS_MAP[run.status];

  const LaneIcon = run.lane === "hermes" ? RefreshCw : Container;

  const primaryAction = (() => {
    if (run.status === "running") return "Cancel";
    if (run.status === "awaiting-approval") return "Approve";
    return "View";
  })();

  return (
    <article
      className="run-card group flex overflow-hidden rounded-lg"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border-brand)",
      }}
    >
      {/* Lane stripe — 2px, pulses when running */}
      <div
        className={cn("run-card__stripe shrink-0 w-0.5", {
          "run-stripe-pulse": isRunning,
        })}
        style={{ backgroundColor: laneColor }}
        aria-hidden
      />

      {/* Card body */}
      <div className="flex flex-col gap-2 px-4 py-3 flex-1 min-w-0">
        {/* Header row */}
        <div className="flex items-start gap-2">
          {/* Lane icon + title */}
          <LaneIcon
            className="mt-0.5 shrink-0"
            size={16}
            strokeWidth={1.5}
            style={{ color: laneColor }}
            aria-label={run.lane === "hermes" ? "Hermes lane" : "Sandcastle lane"}
          />
          <span
            className="flex-1 min-w-0 truncate text-sm font-medium leading-5"
            style={{ color: "var(--text)" }}
          >
            {run.title}
          </span>

          {/* Tags */}
          <div className="flex items-center gap-1 shrink-0">
            {run.tags.map((tag) => (
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

          {/* Status pill */}
          <span
            className="shrink-0 rounded-sm px-1.5 py-px text-[11px] font-medium tracking-wide uppercase"
            style={statusStyle}
          >
            {statusLabel}
          </span>
        </div>

        {/* Meta row */}
        <div
          className="flex items-center gap-2 text-[12px]"
          style={{ color: "var(--text-muted)" }}
        >
          <span className="font-mono" style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
            {formatDuration(run.durationSeconds)}
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
            {modelLabel(run.model)}
          </span>
          <span aria-hidden>·</span>
          <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
            {isRunning ? "~" : ""}{formatCost(run.cost)}
          </span>
        </div>

        {/* Actions row */}
        <div className="flex items-center gap-2">
          {primaryAction === "View" && (
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
          )}
          {primaryAction === "Cancel" && (
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
          )}
          {primaryAction === "Approve" && (
            <button
              type="button"
              className="rounded-md px-2.5 py-1 text-xs font-medium border transition-colors"
              style={{
                borderColor: "var(--accent-gold-400)",
                color: "var(--accent-gold-400)",
                background: "transparent",
              }}
              onClick={() => {}}
            >
              Approve
            </button>
          )}

          {/* Always-visible View link for non-view primary actions */}
          {primaryAction !== "View" && (
            <Link
              href={`/observability/run/${run.id}`}
              className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
              style={{ color: "var(--text-muted)" }}
            >
              View
            </Link>
          )}

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
