"use client";
import { useId } from "react";

/**
 * Health-vista backdrop: a 4-lane CRT oscilloscope. Purely decorative —
 * the traces are hand-tuned squiggles, NOT real latency data, so the
 * lanes carry no service labels (truth pass 2026-07-14: the old
 * hermes/openviking/ollama/postgres captions implied these were live
 * curves). Each lane has its own pine trace, faint baseline, a
 * current-value tick on the rightmost edge, and a soft phosphor glow.
 *
 * The traces are pre-computed SVG path strings (a horizontal squiggle
 * with occasional small spikes). Each lane animates at a different
 * speed via `stroke-dasharray` + `stroke-dashoffset` keyframes so the
 * waves visibly run on their own clocks.
 *
 * Hand-rolled SVG, no chart deps. Decorative; no pointer events.
 */

const VB_WIDTH = 1600;
const VB_HEIGHT = 200;
const LEFT_INSET = 110;
const RIGHT_INSET = 110;
const LANE_TOP = 18;
const LANE_BOTTOM = 18;
const LANE_COUNT = 4;

interface Lane {
  speedSec: number;
  /** Pre-baked path (already in 0..1 normalized x and -1..1 normalized y). */
  bumps: Array<{ x: number; y: number }>;
}

// Hand-tuned bump sequences — each lane gets its own decorative personality
// (stable whisper / steady chatter / modest spikes / more variance).
const LANES: Lane[] = [
  {
    speedSec: 5,
    bumps: [
      { x: 0.08, y: -0.18 }, { x: 0.18, y: 0.12 }, { x: 0.28, y: -0.08 },
      { x: 0.42, y: 0.22 }, { x: 0.55, y: -0.14 }, { x: 0.65, y: 0.08 },
      { x: 0.74, y: -0.20 }, { x: 0.84, y: 0.16 }, { x: 0.92, y: -0.10 },
    ],
  },
  {
    speedSec: 7,
    bumps: [
      { x: 0.06, y: 0.16 }, { x: 0.14, y: -0.22 }, { x: 0.24, y: 0.34 },
      { x: 0.34, y: -0.18 }, { x: 0.45, y: 0.70 }, { x: 0.54, y: -0.28 },
      { x: 0.64, y: 0.22 }, { x: 0.75, y: -0.32 }, { x: 0.86, y: 0.20 },
      { x: 0.94, y: -0.14 },
    ],
  },
  {
    speedSec: 9,
    bumps: [
      { x: 0.07, y: -0.12 }, { x: 0.17, y: 0.18 }, { x: 0.27, y: 0.55 },
      { x: 0.36, y: -0.24 }, { x: 0.48, y: 0.16 }, { x: 0.58, y: -0.18 },
      { x: 0.69, y: 0.48 }, { x: 0.80, y: -0.16 }, { x: 0.90, y: 0.22 },
    ],
  },
  {
    speedSec: 6,
    bumps: [
      { x: 0.05, y: 0.24 }, { x: 0.13, y: -0.36 }, { x: 0.22, y: 0.28 },
      { x: 0.30, y: -0.24 }, { x: 0.40, y: 0.42 }, { x: 0.50, y: -0.38 },
      { x: 0.59, y: 0.32 }, { x: 0.68, y: -0.30 }, { x: 0.78, y: 0.36 },
      { x: 0.87, y: -0.26 }, { x: 0.95, y: 0.18 },
    ],
  },
];

function laneY(idx: number): number {
  const usableH = VB_HEIGHT - LANE_TOP - LANE_BOTTOM;
  return LANE_TOP + (usableH * (idx + 0.5)) / LANE_COUNT;
}

function buildPath(lane: Lane, baselineY: number): string {
  const usableW = VB_WIDTH - LEFT_INSET - RIGHT_INSET;
  // Half a lane's vertical room for peaks/troughs.
  const verticalRoom =
    (VB_HEIGHT - LANE_TOP - LANE_BOTTOM) / LANE_COUNT / 2 - 4;

  const pts: Array<[number, number]> = [];
  pts.push([LEFT_INSET, baselineY]);

  for (const b of lane.bumps) {
    const cx = LEFT_INSET + b.x * usableW;
    const cy = baselineY - b.y * verticalRoom;
    // Small lead-in/out keeps the trace lively but not jagged.
    pts.push([cx - 4, baselineY]);
    pts.push([cx, cy]);
    pts.push([cx + 4, baselineY]);
  }

  pts.push([VB_WIDTH - RIGHT_INSET, baselineY]);

  return pts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join(" ");
}

export function LatencyOscilloscopeBackdrop() {
  const reactId = useId();
  const safe = reactId.replace(/[^a-zA-Z0-9_-]/g, "");
  const glowId = `oscGlow-${safe}`;

  const lanes = LANES.map((lane, i) => {
    const baselineY = laneY(i);
    return {
      ...lane,
      baselineY,
      d: buildPath(lane, baselineY),
    };
  });

  const rightEdge = VB_WIDTH - RIGHT_INSET;

  return (
    <div className="latency-oscilloscope" aria-hidden="true">
      <svg viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`} preserveAspectRatio="none">
        <defs>
          <filter id={glowId} x="-2%" y="-30%" width="104%" height="160%">
            <feGaussianBlur stdDeviation="1.8" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {lanes.map((lane, i) => (
          <g key={i} className={`osc-lane osc-lane-${i}`}>
            <line
              className="osc-baseline"
              x1={LEFT_INSET}
              y1={lane.baselineY}
              x2={rightEdge}
              y2={lane.baselineY}
            />
            <g filter={`url(#${glowId})`}>
              <path
                className="osc-trace"
                d={lane.d}
                style={{
                  // Per-lane sweep speed via custom property; CSS consumes it.
                  ["--osc-speed" as string]: `${lane.speedSec}s`,
                }}
              />
            </g>
            <line
              className="osc-now-tick"
              x1={rightEdge}
              y1={lane.baselineY - 6}
              x2={rightEdge}
              y2={lane.baselineY + 6}
            />
          </g>
        ))}
      </svg>
    </div>
  );
}

export default LatencyOscilloscopeBackdrop;
