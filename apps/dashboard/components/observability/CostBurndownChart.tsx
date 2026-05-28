"use client";
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Card, CardAction, CardHead, CardTitle } from "@/components/ui/Card";

type BurndownRange = "24h" | "30d";

interface BurndownPoint {
  at: string;
  cents: number;
}

interface BurndownResponse {
  range: BurndownRange;
  bucket: string;
  points: BurndownPoint[];
}

const VBW = 280;
const VBH = 64;

const CostIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

function buildPaths(points: BurndownPoint[]): {
  line: string;
  area: string;
  coords: Array<{ x: number; y: number; cents: number; at: string }>;
} {
  if (points.length === 0) return { line: "", area: "", coords: [] };
  const maxCents = points.reduce((m, p) => Math.max(m, p.cents), 0);
  const step = points.length > 1 ? VBW / (points.length - 1) : 0;
  const coords = points.map((p, i) => {
    const x = points.length === 1 ? VBW / 2 : i * step;
    const norm = maxCents === 0 ? 0 : p.cents / maxCents;
    // Invert + leave 6px headroom top, 4px bottom.
    const y = VBH - 4 - norm * (VBH - 10);
    return { x, y, cents: p.cents, at: p.at };
  });
  const line = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(2)},${c.y.toFixed(2)}`)
    .join(" ");
  const first = coords[0];
  const last = coords[coords.length - 1];
  const area = `${line} L${last.x.toFixed(2)},${VBH} L${first.x.toFixed(2)},${VBH} Z`;
  return { line, area, coords };
}

function formatTooltip(at: string, cents: number): string {
  const d = new Date(at);
  const dollars = (cents / 100).toFixed(2);
  if (Number.isNaN(d.getTime())) return `$${dollars}`;
  const ts = d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `$${dollars} · ${ts}`;
}

export function CostBurndownChart() {
  const [range, setRange] = useState<BurndownRange>("24h");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{
    idx: number;
    pxX: number;
    pxY: number;
  } | null>(null);

  const { data, isLoading } = useQuery<BurndownResponse>({
    queryKey: ["cost", "burndown", range],
    queryFn: async () => {
      const res = await fetch(`/api/cost/burndown?range=${range}`);
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const points = useMemo(() => data?.points ?? [], [data?.points]);
  const { line, area, coords } = useMemo(() => buildPaths(points), [points]);
  const totalCents = points.reduce((s, p) => s + p.cents, 0);

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (coords.length === 0 || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const xRatio = relX / rect.width;
    const targetX = xRatio * VBW;
    let bestIdx = 0;
    let bestDist = Infinity;
    coords.forEach((c, i) => {
      const d = Math.abs(c.x - targetX);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    });
    const c = coords[bestIdx];
    setHover({
      idx: bestIdx,
      pxX: (c.x / VBW) * rect.width,
      pxY: (c.y / VBH) * rect.height,
    });
  }

  function handleMouseLeave() {
    setHover(null);
  }

  const hoveredPoint = hover ? points[hover.idx] : null;

  return (
    <Card lane="gold">
      <CardHead>
        <CardTitle icon={CostIcon}>Cost burndown</CardTitle>
        <CardAction>
          <span className="range-toggle" role="tablist" aria-label="Burndown range">
            {(["24h", "30d"] as const).map((r, i) => (
              <span key={r}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={range === r}
                  onClick={() => setRange(r)}
                >
                  {r}
                </button>
                {i === 0 ? <span aria-hidden="true"> · </span> : null}
              </span>
            ))}
          </span>
        </CardAction>
      </CardHead>
      {isLoading ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          Loading…
        </div>
      ) : points.length === 0 ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          No spend recorded in this range.
        </div>
      ) : (
        <>
          <div
            ref={wrapRef}
            className="spark-wrap"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            <svg
              viewBox={`0 0 ${VBW} ${VBH}`}
              preserveAspectRatio="none"
              aria-label={`${range} cost sparkline`}
            >
              <defs>
                <linearGradient id="goldFade" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#c9a227" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#c9a227" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              <path fill="url(#goldFade)" d={area} />
              <path className="spark-line" d={line} />
              {coords.length > 0 ? (
                <circle
                  className="spark-dot"
                  cx={coords[coords.length - 1].x}
                  cy={coords[coords.length - 1].y}
                  r={3.5}
                />
              ) : null}
              {hover ? (
                <circle
                  cx={coords[hover.idx].x}
                  cy={coords[hover.idx].y}
                  r={3}
                  fill="var(--gold-bright)"
                />
              ) : null}
            </svg>
            {hover && hoveredPoint ? (
              <div
                className="spark-tooltip visible"
                style={{ left: hover.pxX, top: hover.pxY }}
                role="tooltip"
              >
                {formatTooltip(hoveredPoint.at, hoveredPoint.cents)}
              </div>
            ) : null}
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
            }}
          >
            <div className="big-num">
              ${(totalCents / 100).toFixed(2)}
              <span className="of">total · {points.length} buckets</span>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
