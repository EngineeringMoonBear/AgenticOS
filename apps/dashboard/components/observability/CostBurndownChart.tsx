"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

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

const VIEWBOX_W = 600;
const VIEWBOX_H = 160;
const PAD_X = 8;
const PAD_Y = 8;

export function CostBurndownChart() {
  const [range, setRange] = useState<BurndownRange>("24h");

  const { data, isLoading } = useQuery<BurndownResponse>({
    queryKey: ["cost", "burndown", range],
    queryFn: async () => {
      const res = await fetch(`/api/cost/burndown?range=${range}`);
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const points = data?.points ?? [];
  const maxCents = points.reduce((m, p) => Math.max(m, p.cents), 0);
  const drawW = VIEWBOX_W - PAD_X * 2;
  const drawH = VIEWBOX_H - PAD_Y * 2;
  const barWidth = points.length > 0 ? drawW / points.length : 0;

  return (
    <div className="p-4 space-y-3 border rounded-md">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Cost burndown</h3>
        <div role="tablist" aria-label="Burndown range" className="flex gap-1 text-xs">
          {(["24h", "30d"] as const).map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={range === r}
              onClick={() => setRange(r)}
              className={`px-2 py-1 rounded font-mono ${
                range === r
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : points.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No spend recorded in this range.
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
          className="w-full h-40"
          aria-label={`Cost burndown for last ${range}`}
        >
          {points.map((p, i) => {
            const h = maxCents === 0 ? 0 : (p.cents / maxCents) * drawH;
            return (
              <rect
                key={`${p.at}-${i}`}
                x={PAD_X + i * barWidth}
                y={PAD_Y + (drawH - h)}
                width={Math.max(1, barWidth - 1)}
                height={Math.max(0, h)}
                fill="var(--accent-plum-400, #8b5fbf)"
              />
            );
          })}
        </svg>
      )}
      {points.length > 0 ? (
        <div className="text-xs text-muted-foreground font-mono">
          peak {(maxCents / 100).toFixed(2)} USD · {points.length} buckets
        </div>
      ) : null}
    </div>
  );
}
