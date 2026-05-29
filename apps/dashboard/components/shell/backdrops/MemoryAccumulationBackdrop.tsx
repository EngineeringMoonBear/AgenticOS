"use client";
import { useId } from "react";

/**
 * Memory-vista backdrop: a slow stacked-area chart showing memory
 * accumulation over the last ~30 days, broken out by scope. The four
 * layers (resources / user / session / agent-skills) all trend upward
 * monotonically — visually communicating "knowledge is layering."
 *
 *  - Bottom (largest) layer:  resources           sage @ 60%
 *  - Next:                    user/memories       sage @ 45%
 *  - Next:                    session/*           sage @ 30%
 *  - Top (thinnest):          agent/skills        sage @ 18%
 *
 * A thin sage glow scrolls right-to-left along the topmost edge to
 * suggest "fresh deposits forming." Reduced-motion users get a static
 * glow at the rightmost edge.
 *
 * Hand-rolled SVG, no chart deps. Decorative; no pointer events.
 */

const VB_WIDTH = 1600;
const VB_HEIGHT = 200;
const LEFT_INSET = 110;
const RIGHT_INSET = 110;
const TOP_INSET = 24;
const BOTTOM_INSET = 24;

// Per-scope cumulative totals (today). Choose so they stack into a
// visually pleasing pyramid where resources dominates.
const RESOURCES_END = 1204; // visible largest
const USER_END = 282;
const SESSION_END = 124;
const SKILLS_END = 42;

// Number of x-axis samples (30 days).
const DAYS = 30;

function smoothRamp(end: number, slowStart = 0.15): number[] {
  // Slight ease-out curve: starts a bit smaller, grows toward `end`.
  const pts: number[] = [];
  for (let i = 0; i < DAYS; i++) {
    const t = i / (DAYS - 1);
    // Eased curve: t^0.85 climbs faster early then settles.
    const eased = Math.pow(t, 0.85);
    pts.push(slowStart * end + (1 - slowStart) * end * eased);
  }
  return pts;
}

function xForDay(i: number): number {
  const t = i / (DAYS - 1);
  return LEFT_INSET + t * (VB_WIDTH - LEFT_INSET - RIGHT_INSET);
}

function yForValue(v: number, max: number): number {
  const t = max === 0 ? 0 : v / max;
  const usableH = VB_HEIGHT - TOP_INSET - BOTTOM_INSET;
  return VB_HEIGHT - BOTTOM_INSET - t * usableH;
}

function areaPath(top: number[], bottom: number[], max: number): string {
  const upper = top
    .map((v, i) => `${i === 0 ? "M" : "L"} ${xForDay(i).toFixed(1)} ${yForValue(v, max).toFixed(1)}`)
    .join(" ");
  const lower = bottom
    .map((v, i) => {
      const idx = bottom.length - 1 - i;
      return `L ${xForDay(idx).toFixed(1)} ${yForValue(bottom[idx], max).toFixed(1)}`;
    })
    .join(" ");
  return `${upper} ${lower} Z`;
}

function linePath(series: number[], max: number): string {
  return series
    .map((v, i) => `${i === 0 ? "M" : "L"} ${xForDay(i).toFixed(1)} ${yForValue(v, max).toFixed(1)}`)
    .join(" ");
}

export function MemoryAccumulationBackdrop() {
  const reactId = useId();
  const safe = reactId.replace(/[^a-zA-Z0-9_-]/g, "");
  const glowId = `memGlow-${safe}`;

  const resources = smoothRamp(RESOURCES_END);
  const user = smoothRamp(USER_END);
  const session = smoothRamp(SESSION_END);
  const skills = smoothRamp(SKILLS_END);

  // Stack cumulatively.
  const lvl1 = resources;
  const lvl2 = resources.map((v, i) => v + user[i]);
  const lvl3 = lvl2.map((v, i) => v + session[i]);
  const lvl4 = lvl3.map((v, i) => v + skills[i]);

  const baseline = new Array(DAYS).fill(0);
  const yMax = lvl4[lvl4.length - 1] * 1.08;

  const topEdgeD = linePath(lvl4, yMax);
  const topNowX = xForDay(DAYS - 1);
  const topNowY = yForValue(lvl4[lvl4.length - 1], yMax);

  return (
    <div className="memory-accumulation" aria-hidden="true">
      <svg viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`} preserveAspectRatio="none">
        <defs>
          <filter id={glowId} x="-2%" y="-50%" width="104%" height="200%">
            <feGaussianBlur stdDeviation="2.4" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Stacked areas, bottom → top. */}
        <path
          className="memory-layer memory-layer-resources"
          d={areaPath(lvl1, baseline, yMax)}
        />
        <path
          className="memory-layer memory-layer-user"
          d={areaPath(lvl2, lvl1, yMax)}
        />
        <path
          className="memory-layer memory-layer-session"
          d={areaPath(lvl3, lvl2, yMax)}
        />
        <path
          className="memory-layer memory-layer-skills"
          d={areaPath(lvl4, lvl3, yMax)}
        />

        {/* Glowing top edge (scrolling sweep via CSS dashoffset). */}
        <g filter={`url(#${glowId})`}>
          <path className="memory-top-edge" d={topEdgeD} />
        </g>

        {/* Now dot at the topmost current point. */}
        <circle
          className="memory-now-dot"
          cx={topNowX}
          cy={topNowY}
          r="3.4"
        />
      </svg>
    </div>
  );
}

export default MemoryAccumulationBackdrop;
