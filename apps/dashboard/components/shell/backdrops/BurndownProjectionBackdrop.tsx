"use client";
import { useId, useMemo } from "react";

/**
 * Cost-vista backdrop: a subtly animated full-bleed area+line chart that
 * shows MTD spend climbing toward a projected end-of-month total under a
 * faint russet cap rule.
 *
 *  - Actual spend: solid gold line + gold-ghost area fade (static).
 *  - Projection:   dashed russet line from "now" → end-of-month, with a
 *                  slow right-to-left dash scroll suggesting "still
 *                  flowing." Pure CSS via `stroke-dashoffset` keyframes.
 *  - Cap rule:     faint russet horizontal at the $200 ceiling with a
 *                  small "cap" mono label.
 *  - Now marker:   pale vertical rule at today's x + small gold dot at
 *                  the current value.
 *
 * Hand-rolled SVG, no chart deps. Decorative, no pointer events.
 */
export interface BurndownProjectionBackdropProps {
  /** Per-day cumulative spend, in dollars, length = daysInMonth. */
  actualByDay: number[];
  /** 0-indexed "today" within `actualByDay` — values past this are unknown. */
  todayIndex: number;
  /** Projected end-of-month cumulative total in dollars. */
  projectedEom: number;
  /** Monthly cap in dollars (faint russet rule). */
  cap: number;
}

const VB_WIDTH = 1600;
const VB_HEIGHT = 200;
const LEFT_INSET = 110;
const RIGHT_INSET = 110;
const TOP_INSET = 26;
const BOTTOM_INSET = 30;

function xForDay(i: number, lastIdx: number): number {
  const t = lastIdx === 0 ? 0 : i / lastIdx;
  return LEFT_INSET + t * (VB_WIDTH - LEFT_INSET - RIGHT_INSET);
}

function yForValue(v: number, max: number): number {
  const t = max === 0 ? 0 : v / max;
  // Clamp to [0,1] so values slightly above the cap don't escape the panel.
  const clamped = Math.max(0, Math.min(1, t));
  const usableH = VB_HEIGHT - TOP_INSET - BOTTOM_INSET;
  return VB_HEIGHT - BOTTOM_INSET - clamped * usableH;
}

export function BurndownProjectionBackdrop({
  actualByDay,
  todayIndex,
  projectedEom,
  cap,
}: BurndownProjectionBackdropProps) {
  const reactId = useId();
  const safe = reactId.replace(/[^a-zA-Z0-9_-]/g, "");
  const goldFadeId = `burnGold-${safe}`;

  const { actualLine, actualArea, projLine, nowX, nowY, capY } = useMemo(() => {
    const lastIdx = actualByDay.length - 1;
    const yMax = Math.max(cap, projectedEom) * 1.05;

    // Actual line through day 0..todayIndex.
    const ptsActual: [number, number][] = [];
    for (let i = 0; i <= todayIndex && i < actualByDay.length; i++) {
      ptsActual.push([xForDay(i, lastIdx), yForValue(actualByDay[i], yMax)]);
    }

    const lineD = ptsActual
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`)
      .join(" ");

    const baseY = VB_HEIGHT - BOTTOM_INSET;
    const areaD = ptsActual.length
      ? `M ${ptsActual[0][0].toFixed(2)} ${baseY} ` +
        ptsActual
          .map((p) => `L ${p[0].toFixed(2)} ${p[1].toFixed(2)}`)
          .join(" ") +
        ` L ${ptsActual[ptsActual.length - 1][0].toFixed(2)} ${baseY} Z`
      : "";

    // Projection: from (today, actual[today]) to (lastIdx, projectedEom).
    const nowXv = xForDay(todayIndex, lastIdx);
    const nowYv = yForValue(actualByDay[todayIndex] ?? 0, yMax);
    const projEndX = xForDay(lastIdx, lastIdx);
    const projEndY = yForValue(projectedEom, yMax);
    const projD = `M ${nowXv.toFixed(2)} ${nowYv.toFixed(2)} L ${projEndX.toFixed(2)} ${projEndY.toFixed(2)}`;

    const capYv = yForValue(cap, yMax);

    return {
      actualLine: lineD,
      actualArea: areaD,
      projLine: projD,
      nowX: nowXv,
      nowY: nowYv,
      capY: capYv,
    };
  }, [actualByDay, todayIndex, projectedEom, cap]);

  const baselineY = VB_HEIGHT - BOTTOM_INSET;
  const rightEdge = VB_WIDTH - RIGHT_INSET;

  return (
    <div className="burndown-projection" aria-hidden="true">
      <svg viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={goldFadeId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c9a227" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#c9a227" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Baseline. */}
        <line
          className="burndown-baseline"
          x1={LEFT_INSET}
          y1={baselineY}
          x2={rightEdge}
          y2={baselineY}
        />

        {/* Cap rule. */}
        <line
          className="burndown-cap"
          x1={LEFT_INSET}
          y1={capY}
          x2={rightEdge}
          y2={capY}
        />
        <text
          className="burndown-cap-label"
          x={rightEdge + 4}
          y={capY + 3}
        >
          cap
        </text>

        {/* Actual area + line. */}
        {actualArea && <path className="burndown-area" d={actualArea} fill={`url(#${goldFadeId})`} />}
        {actualLine && <path className="burndown-actual" d={actualLine} />}

        {/* Projection dashed line. */}
        <path className="burndown-projection-line" d={projLine} />

        {/* Now marker. */}
        <line
          className="burndown-now-edge"
          x1={nowX}
          y1={TOP_INSET}
          x2={nowX}
          y2={baselineY}
        />
        <circle className="burndown-now-dot" cx={nowX} cy={nowY} r="3.4" />
      </svg>
    </div>
  );
}

export default BurndownProjectionBackdrop;
