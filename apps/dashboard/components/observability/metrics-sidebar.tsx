"use client";

import Link from "next/link";
import { useRunFeed } from "@/lib/hooks/use-run-feed";
import { useHermesCron } from "@/lib/hooks/use-hermes-cron";
import { RateLimitsPanel } from "./RateLimitsPanel";

interface MetricsSidebarProps {
  filterActive: boolean;
  filteredCount?: number;
}

// Cost sparkline — tiny SVG placeholder (Phase 3 — full rate-limit sparkline via RateLimitsPanel)
function CostSparkline() {
  const points = [0.32, 0.61, 0.44, 0.88, 0.42, 1.2, 0.73];
  const max = Math.max(...points);
  const width = 80;
  const height = 20;
  const step = width / (points.length - 1);

  const pathD = points
    .map((v, i) => {
      const x = i * step;
      const y = height - (v / max) * (height - 2) - 1;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      aria-label="Weekly cost sparkline"
      style={{ display: "block" }}
    >
      <path
        d={pathD}
        fill="none"
        stroke="var(--accent-plum-400)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MetricsSidebar({ filterActive, filteredCount }: MetricsSidebarProps) {
  const { data: runs } = useRunFeed({ limit: 100 });
  const { data: schedules } = useHermesCron();

  const allRuns = runs ?? [];
  const totalCost = allRuns.reduce((acc, r) => acc + (r.costUsd ?? 0), 0);

  return (
    <aside
      className="w-[280px] shrink-0 flex flex-col gap-5 p-4 overflow-y-auto"
      style={{ borderLeft: "1px solid var(--border-subtle)" }}
    >
      {/* Metrics panel */}
      <section>
        <p
          className="text-[11px] font-semibold uppercase tracking-widest mb-3"
          style={{ color: "var(--text-muted)" }}
        >
          Metrics — today
          {filterActive && filteredCount !== undefined && (
            <span
              className="ml-1.5 font-normal normal-case"
              style={{ color: "var(--accent-plum-400)" }}
            >
              (filtered: {filteredCount} shown)
            </span>
          )}
        </p>

        <dl className="flex flex-col gap-1.5">
          <div className="flex justify-between items-baseline">
            <dt className="text-xs" style={{ color: "var(--text-muted)" }}>
              Total
            </dt>
            <dd
              className="text-xs font-medium"
              style={{
                color: "var(--text)",
                fontFamily: "var(--font-jetbrains-mono, monospace)",
              }}
            >
              ${totalCost.toFixed(2)} · {allRuns.length} runs
            </dd>
          </div>
          <div className="flex justify-between items-baseline">
            <dt className="text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: "var(--lane-hermes)" }}
                aria-label="Hermes lane"
              />
              Hermes
            </dt>
            <dd
              className="text-xs"
              style={{
                color: "var(--text-secondary)",
                fontFamily: "var(--font-jetbrains-mono, monospace)",
              }}
            >
              ${totalCost.toFixed(2)}
            </dd>
          </div>
        </dl>
      </section>

      {/* Costs sparkline panel */}
      <section>
        <p
          className="text-[11px] font-semibold uppercase tracking-widest mb-3"
          style={{ color: "var(--text-muted)" }}
        >
          Costs — 7 days
        </p>
        <CostSparkline />
        <p
          className="mt-1.5 text-[11px]"
          style={{ color: "var(--text-muted)" }}
        >
          Full charts coming in Phase 4.
        </p>
      </section>

      {/* Schedule panel — wired to useHermesCron */}
      <section>
        <p
          className="text-[11px] font-semibold uppercase tracking-widest mb-3"
          style={{ color: "var(--text-muted)" }}
        >
          Schedule — next runs
        </p>
        {schedules && schedules.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {schedules.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2">
                <span className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
                  {item.skillId}
                </span>
                <span
                  className="shrink-0 text-[11px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  {item.nextRunAt
                    ? new Date(item.nextRunAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                    : "—"}
                  {" "}
                  <span style={{ color: item.enabled ? "var(--success)" : "var(--text-muted)" }}>
                    {item.enabled ? "●" : "○"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            No schedules configured.
          </p>
        )}
        <Link
          href="/observability/schedules"
          className="mt-3 text-xs underline transition-colors inline-block"
          style={{ color: "var(--accent-plum-400)" }}
        >
          Manage schedules →
        </Link>
      </section>

      {/* Rate limits panel */}
      <div className="mt-6">
        <RateLimitsPanel />
      </div>
    </aside>
  );
}
