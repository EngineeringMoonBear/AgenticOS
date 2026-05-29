"use client";
import { useId, useMemo } from "react";

/**
 * Radial constellation backdrop for the Architecture vista. Each domain
 * is plotted around a faint central origin as a copper disc whose radius
 * is proportional to its skill count. The largest domain gets a softer-
 * bright halo via the SVG filter; domains with zero skills render as a
 * hollow ring so they still appear on the chart.
 *
 * Hand-rolled SVG, no chart library. Decorative; no pointer events.
 */
export interface SkillGalaxyDomain {
  name: string;
  count: number;
  dispatchedToday: number;
}

export interface SkillGalaxyBackdropProps {
  domains: SkillGalaxyDomain[];
}

const VB_WIDTH = 1600;
const VB_HEIGHT = 200;
const CENTER_X = VB_WIDTH / 2;
const CENTER_Y = VB_HEIGHT / 2;
const RING_RADIUS_X = 380;
const RING_RADIUS_Y = 70;

function nodeRadius(count: number, max: number): number {
  if (count <= 0) return 6;
  // Scale 1..max into ~10..28 px.
  const t = max > 0 ? count / max : 0;
  return 10 + t * 18;
}

export function SkillGalaxyBackdrop({ domains }: SkillGalaxyBackdropProps) {
  const reactId = useId();
  const safe = reactId.replace(/[^a-zA-Z0-9_-]/g, "");
  const haloId = `galaxyHalo-${safe}`;
  const softHaloId = `galaxySoft-${safe}`;

  const { nodes, maxCount } = useMemo(() => {
    const maxCount = domains.reduce((m, d) => Math.max(m, d.count), 0);
    const n = domains.length;
    const nodes = domains.map((d, i) => {
      // Spread around an ellipse with a small phase offset so the
      // arrangement looks orbital rather than perfectly symmetric.
      const angle = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
      const cx = CENTER_X + Math.cos(angle) * RING_RADIUS_X;
      const cy = CENTER_Y + Math.sin(angle) * RING_RADIUS_Y;
      return {
        ...d,
        cx,
        cy,
        r: nodeRadius(d.count, maxCount),
        isMax: d.count === maxCount && maxCount > 0,
        isEmpty: d.count === 0,
      };
    });
    return { nodes, maxCount };
  }, [domains]);

  return (
    <div className="skill-galaxy" aria-hidden="true">
      <svg
        viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
        preserveAspectRatio="none"
      >
        <defs>
          <filter id={haloId} x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="3.6" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter
            id={softHaloId}
            x="-200%"
            y="-200%"
            width="500%"
            height="500%"
          >
            <feGaussianBlur stdDeviation="1.8" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Faint central origin. */}
        <circle
          className="galaxy-core"
          cx={CENTER_X}
          cy={CENTER_Y}
          r="4"
          filter={`url(#${softHaloId})`}
        />

        {/* Spokes from origin to each node. */}
        {nodes.map((n, i) => (
          <line
            key={`spoke-${i}-${n.name}`}
            className="galaxy-spoke"
            x1={CENTER_X}
            y1={CENTER_Y}
            x2={n.cx}
            y2={n.cy}
          />
        ))}

        {/* Domain nodes. */}
        {nodes.map((n, i) => {
          if (n.isEmpty) {
            return (
              <circle
                key={`node-${i}-${n.name}`}
                className="galaxy-node galaxy-node-empty"
                cx={n.cx}
                cy={n.cy}
                r={n.r}
              />
            );
          }
          return (
            <circle
              key={`node-${i}-${n.name}`}
              className={`galaxy-node${n.isMax ? " galaxy-node-max" : ""}`}
              cx={n.cx}
              cy={n.cy}
              r={n.r}
              filter={n.isMax ? `url(#${haloId})` : `url(#${softHaloId})`}
            />
          );
        })}
      </svg>
      {/* Persist maxCount in the DOM for downstream tooling/tests. */}
      <span hidden data-galaxy-max={maxCount} />
    </div>
  );
}

export default SkillGalaxyBackdrop;
