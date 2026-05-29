"use client";
import { useId, useMemo } from "react";

/**
 * Runs-vista backdrop: a stacked-bar throughput chart of the last 60
 * minutes of run activity, bucketed at {@link BUCKET_MIN}-minute
 * resolution and stacked by terminal status (done · failed · running).
 *
 * Reads as a real graph at a glance: faint y-axis gridlines, x-axis
 * time labels (-60m / -45m / -30m / -15m / now), a baseline rule, and
 * a slow gold sweep line that crosses the plot every
 * {@link SWEEP_DURATION_S} seconds to suggest active polling. The
 * rightmost bucket — anything still in-flight — pulses gold on top.
 *
 * Hand-rolled SVG. No chart deps. Decorative; no pointer events.
 *
 * Two knobs worth tuning:
 *   • {@link BUCKET_MIN} — bucket width in minutes. 5 reads as "runs
 *     per 5-minute window"; 6 gives a tidy 10 buckets across the hour
 *     and slightly fatter bars; 10 is calmer but loses resolution.
 *   • {@link SWEEP_DURATION_S} — one pass of the sweep line. 8s feels
 *     active; 14-18s feels ambient.
 */
export interface ActivityStripEvent {
  /** ISO timestamp for the event. */
  at: string;
  status: "running" | "done" | "failed";
}

export interface ActivityStripBackdropProps {
  events: ActivityStripEvent[];
  /**
   * Reference timestamp used as the rightmost "now" edge of the chart.
   * Required so the render stays pure — callers should pin this to a
   * mount-time value (see `RunsVista`) rather than re-reading the
   * clock during render.
   */
  now: string;
}

// SVG viewBox geometry. The vista renders this scaled to fit, so all
// numbers are in viewBox units, not pixels.
const VB_WIDTH = 1600;
const VB_HEIGHT = 200;
const LEFT_INSET = 80;
const RIGHT_INSET = 110;
const TOP_INSET = 22;
const BOTTOM_INSET = 36;

const WINDOW_MS = 60 * 60 * 1000;
const BUCKET_MIN = 5;
const NUM_BUCKETS = 60 / BUCKET_MIN; // 12
const BUCKET_MS = BUCKET_MIN * 60_000;

const SWEEP_DURATION_S = 8;

// Visual scale floor — keeps tiny throughput from looking enormous
// (i.e. a single run in an empty hour shouldn't fill the whole y-axis).
const MIN_Y_SCALE = 6;

interface Bucket {
  /** 0 = oldest (left edge), NUM_BUCKETS-1 = newest (right edge). */
  index: number;
  done: number;
  failed: number;
  running: number;
  total: number;
}

function bucketize(
  events: ActivityStripEvent[],
  nowMs: number,
): Bucket[] {
  const buckets: Bucket[] = Array.from({ length: NUM_BUCKETS }, (_, i) => ({
    index: i,
    done: 0,
    failed: 0,
    running: 0,
    total: 0,
  }));
  for (const e of events) {
    const ms = new Date(e.at).getTime();
    if (Number.isNaN(ms)) continue;
    const ageMs = nowMs - ms;
    if (ageMs < 0 || ageMs >= WINDOW_MS) continue;
    // Newest bucket is rightmost — index = NUM_BUCKETS - 1 when age=0.
    const idx = Math.min(
      NUM_BUCKETS - 1,
      Math.max(0, NUM_BUCKETS - 1 - Math.floor(ageMs / BUCKET_MS)),
    );
    const b = buckets[idx];
    b[e.status] += 1;
    b.total += 1;
  }
  return buckets;
}

export function ActivityStripBackdrop({
  events,
  now,
}: ActivityStripBackdropProps) {
  const reactId = useId();
  const safe = reactId.replace(/[^a-zA-Z0-9_-]/g, "");
  const runningGlowId = `actRunGlow-${safe}`;
  const sweepGradId = `actSweep-${safe}`;

  const nowMs = useMemo(() => new Date(now).getTime(), [now]);
  const buckets = useMemo(() => bucketize(events, nowMs), [events, nowMs]);

  const plotWidth = VB_WIDTH - LEFT_INSET - RIGHT_INSET;
  const plotHeight = VB_HEIGHT - TOP_INSET - BOTTOM_INSET;
  const baselineY = VB_HEIGHT - BOTTOM_INSET;
  const topY = TOP_INSET;

  const bucketWidth = plotWidth / NUM_BUCKETS;
  const barWidth = bucketWidth * 0.66;

  const yScale = useMemo(() => {
    const observedMax = buckets.reduce((m, b) => Math.max(m, b.total), 0);
    return Math.max(MIN_Y_SCALE, observedMax);
  }, [buckets]);

  const yForCount = (count: number): number =>
    baselineY - (count / yScale) * plotHeight;

  // Y-axis gridline counts: roughly 1/3, 2/3, full.
  const gridSteps = useMemo(() => {
    const stops: number[] = [];
    const a = Math.max(1, Math.round(yScale / 3));
    const b = Math.max(2, Math.round((yScale * 2) / 3));
    for (const s of [a, b, yScale]) {
      if (!stops.includes(s)) stops.push(s);
    }
    return stops;
  }, [yScale]);

  // X-axis labels: -60m / -45m / -30m / -15m / now.
  const xAxisLabels = useMemo(
    () => [
      { x: LEFT_INSET, label: "-60m" },
      { x: LEFT_INSET + plotWidth * 0.25, label: "-45m" },
      { x: LEFT_INSET + plotWidth * 0.5, label: "-30m" },
      { x: LEFT_INSET + plotWidth * 0.75, label: "-15m" },
      { x: LEFT_INSET + plotWidth, label: "now" },
    ],
    [plotWidth],
  );

  return (
    <div className="activity-strip" aria-hidden="true">
      <svg
        viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
        preserveAspectRatio="none"
      >
        <defs>
          <filter
            id={runningGlowId}
            x="-100%"
            y="-100%"
            width="300%"
            height="300%"
          >
            <feGaussianBlur stdDeviation="2.2" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id={sweepGradId} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="var(--gold-bright)" stopOpacity="0" />
            <stop offset="50%" stopColor="var(--gold-bright)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--gold-bright)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Y-axis gridlines (faint) + count labels at the left. */}
        {gridSteps.map((step) => {
          const y = yForCount(step);
          return (
            <g key={`grid-${step}`} className="activity-grid">
              <line
                className="activity-gridline"
                x1={LEFT_INSET}
                y1={y}
                x2={LEFT_INSET + plotWidth}
                y2={y}
              />
              <text
                className="activity-y-label"
                x={LEFT_INSET - 8}
                y={y + 3}
                textAnchor="end"
              >
                {step}
              </text>
            </g>
          );
        })}

        {/* Y-axis title (rotated mono). */}
        <text
          className="activity-y-title"
          x={LEFT_INSET - 56}
          y={topY + plotHeight / 2}
          transform={`rotate(-90 ${LEFT_INSET - 56} ${topY + plotHeight / 2})`}
          textAnchor="middle"
        >
          runs / {BUCKET_MIN}m
        </text>

        {/* Baseline (chart bottom). */}
        <line
          className="activity-baseline"
          x1={LEFT_INSET}
          y1={baselineY}
          x2={LEFT_INSET + plotWidth}
          y2={baselineY}
        />

        {/* Sweep line — slow scan that suggests active polling. */}
        <rect
          className="activity-sweep"
          x={LEFT_INSET}
          y={topY}
          width={plotWidth * 0.18}
          height={plotHeight}
          fill={`url(#${sweepGradId})`}
          style={{
            ["--sweep-distance" as string]: `${plotWidth * 0.82}px`,
            ["--sweep-duration" as string]: `${SWEEP_DURATION_S}s`,
          }}
        />

        {/* Stacked bars, one per bucket. Bottom→top: done · failed · running. */}
        {buckets.map((b) => {
          if (b.total === 0) return null;
          const cx = LEFT_INSET + (b.index + 0.5) * bucketWidth;
          const x = cx - barWidth / 2;

          // y positions: cumulative from the baseline upward.
          const yDoneTop = yForCount(b.done);
          const yFailedTop = yForCount(b.done + b.failed);
          const yRunningTop = yForCount(b.total);

          const isLatest = b.index === NUM_BUCKETS - 1;
          const hasRunning = b.running > 0;

          return (
            <g key={`bar-${b.index}`} className="activity-bar-group">
              {b.done > 0 && (
                <rect
                  className="activity-bar-done"
                  x={x}
                  y={yDoneTop}
                  width={barWidth}
                  height={baselineY - yDoneTop}
                  rx="1.5"
                />
              )}
              {b.failed > 0 && (
                <rect
                  className="activity-bar-failed"
                  x={x}
                  y={yFailedTop}
                  width={barWidth}
                  height={yDoneTop - yFailedTop}
                  rx="1.5"
                />
              )}
              {b.running > 0 && (
                <rect
                  className={`activity-bar-running${isLatest ? " activity-bar-running--latest" : ""}`}
                  x={x}
                  y={yRunningTop}
                  width={barWidth}
                  height={yFailedTop - yRunningTop}
                  rx="1.5"
                  filter={isLatest ? `url(#${runningGlowId})` : undefined}
                />
              )}
              {/* Crown dot on the latest bar with active runs — anchors the eye. */}
              {isLatest && hasRunning && (
                <circle
                  className="activity-latest-dot"
                  cx={cx}
                  cy={yRunningTop - 4}
                  r="2.6"
                  filter={`url(#${runningGlowId})`}
                />
              )}
            </g>
          );
        })}

        {/* X-axis labels. */}
        {xAxisLabels.map((lab) => (
          <text
            key={`xl-${lab.label}`}
            className={`activity-x-label${lab.label === "now" ? " activity-x-label--now" : ""}`}
            x={lab.x}
            y={VB_HEIGHT - 12}
            textAnchor={
              lab.label === "-60m" ? "start" : lab.label === "now" ? "end" : "middle"
            }
          >
            {lab.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

export default ActivityStripBackdrop;
