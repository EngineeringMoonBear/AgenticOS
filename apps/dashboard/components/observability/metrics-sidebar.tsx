"use client";

import type { Run } from "@/lib/fixtures/runs";
import { RUN_FIXTURES } from "@/lib/fixtures/runs";

interface MetricsSidebarProps {
  /** Filtered runs — used to show (filtered) indicator */
  filteredRuns: Run[];
  filterActive: boolean;
}

// Static schedule fixture — Phase 2 will wire to real cron data
const SCHEDULE = [
  { label: "Farm Morning Brief", cron: "0 7 * * *", display: "07:00 daily", done: true },
  { label: "Daily Asana Triage", cron: "0 8 * * 1-5", display: "08:00 weekdays", done: true },
  { label: "Hermes Curator", cron: "0 0 * * 0", display: "Sun 00:00", done: false },
];

// Cost sparkline — tiny SVG placeholder
function CostSparkline() {
  // 7 data points, normalized to a 0-1 scale (week Mon-Sun)
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

export function MetricsSidebar({ filteredRuns, filterActive }: MetricsSidebarProps) {
  // Metrics always show totals from all fixtures
  const allRuns = RUN_FIXTURES;
  const totalCost = allRuns.reduce((acc, r) => acc + r.cost, 0);
  const hermesCost = allRuns
    .filter((r) => r.lane === "hermes")
    .reduce((acc, r) => acc + r.cost, 0);
  const sandcastleCost = allRuns
    .filter((r) => r.lane === "sandcastle")
    .reduce((acc, r) => acc + r.cost, 0);

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
          {filterActive && (
            <span
              className="ml-1.5 font-normal normal-case"
              style={{ color: "var(--accent-plum-400)" }}
            >
              (filtered: {filteredRuns.length} shown)
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
              ${hermesCost.toFixed(2)}
            </dd>
          </div>
          <div className="flex justify-between items-baseline">
            <dt className="text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: "var(--lane-sandcastle)" }}
                aria-label="Sandcastle lane"
              />
              Sandcastle
            </dt>
            <dd
              className="text-xs"
              style={{
                color: "var(--text-secondary)",
                fontFamily: "var(--font-jetbrains-mono, monospace)",
              }}
            >
              ${sandcastleCost.toFixed(2)}
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
          Full charts in Phase 2
        </p>
      </section>

      {/* Schedule panel */}
      <section>
        <p
          className="text-[11px] font-semibold uppercase tracking-widest mb-3"
          style={{ color: "var(--text-muted)" }}
        >
          Schedule — next runs
        </p>
        <ul className="flex flex-col gap-2">
          {SCHEDULE.map((item) => (
            <li key={item.cron} className="flex items-center justify-between gap-2">
              <span className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
                {item.label}
              </span>
              <span
                className="shrink-0 text-[11px]"
                style={{ color: "var(--text-muted)" }}
              >
                {item.display}{" "}
                {item.done ? (
                  <span style={{ color: "var(--success)" }}>✓</span>
                ) : (
                  <span style={{ color: "var(--text-muted)" }}>◌</span>
                )}
              </span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="mt-3 text-xs underline transition-colors"
          style={{ color: "var(--accent-plum-400)" }}
          onClick={() => {}}
        >
          Manage schedules →
        </button>
      </section>
    </aside>
  );
}
