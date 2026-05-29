"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useTrajectory } from "@/lib/hooks/use-trajectory";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

interface RetrievalTrajectoryGraphProps {
  uri: string;
}

interface RangeOption {
  label: string;
  days: number;
}

const RANGES: RangeOption[] = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

function isoSince(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

const KIND_COLORS: Record<string, string> = {
  uri: "#7dd3fc",
  session: "#fda4af",
  agent: "#86efac",
};

interface GraphNodeLike {
  id: string;
  kind: string;
  label: string;
  size?: number;
}

interface GraphLinkLike {
  source: string;
  target: string;
  weight: number;
}

export function RetrievalTrajectoryGraph({ uri }: RetrievalTrajectoryGraphProps) {
  const [rangeIdx, setRangeIdx] = useState(1); // default 30d
  const since = useMemo(() => isoSince(RANGES[rangeIdx].days), [rangeIdx]);
  const { data, isLoading } = useTrajectory(uri, since);

  const graph = useMemo(() => {
    if (!data) return { nodes: [], links: [] };
    return {
      nodes: (data.nodes ?? []) as GraphNodeLike[],
      links: (data.links ?? []) as GraphLinkLike[],
    };
  }, [data]);

  return (
    <div
      role="region"
      aria-label="Retrieval trajectory"
      className="flex h-full w-full flex-col gap-2"
    >
      <div
        role="tablist"
        aria-label="Trajectory range"
        className="flex gap-1 px-1"
      >
        {RANGES.map((r, idx) => {
          const isActive = idx === rangeIdx;
          return (
            <button
              key={r.label}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-pressed={isActive}
              data-selected={isActive ? "true" : undefined}
              onClick={() => setRangeIdx(idx)}
              className="rounded-md px-2 py-1 text-[12px] font-medium transition-colors"
              style={{
                color: isActive ? "var(--sage)" : "var(--text-muted)",
                backgroundColor: isActive
                  ? "var(--surface-elevated)"
                  : "transparent",
                borderBottom: isActive
                  ? "1px solid var(--sage)"
                  : "1px solid transparent",
              }}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      <div className="relative flex-1 min-h-[240px]">
        {isLoading && (
          <p
            className="px-2 py-3 text-[13px]"
            style={{ color: "var(--text-muted)" }}
            role="status"
          >
            Loading trajectory…
          </p>
        )}

        {!isLoading && data?.available === false && (
          <p
            className="px-2 py-3 text-[13px]"
            style={{ color: "var(--text-muted)" }}
          >
            Retrieval trajectories not available with this Viking version.
          </p>
        )}

        {!isLoading &&
          data?.available !== false &&
          graph.nodes.length === 0 && (
            <p
              className="px-2 py-3 text-[13px]"
              style={{ color: "var(--text-muted)" }}
            >
              No retrievals in this window.
            </p>
          )}

        {!isLoading &&
          data?.available !== false &&
          graph.nodes.length > 0 && (
            <ForceGraph2D
              graphData={{ nodes: graph.nodes, links: graph.links }}
              nodeLabel={(n: GraphNodeLike) => `${n.kind}: ${n.label}`}
              nodeRelSize={4}
              nodeVal={(n: GraphNodeLike) => n.size ?? 1}
              nodeColor={(n: GraphNodeLike) =>
                KIND_COLORS[n.kind] ?? "#cbd5e1"
              }
              linkColor={() => "rgba(255,255,255,0.25)"}
              linkWidth={(l: GraphLinkLike) =>
                Math.max(0.5, Math.min(3, l.weight))
              }
              backgroundColor="transparent"
            />
          )}
      </div>
    </div>
  );
}

export default RetrievalTrajectoryGraph;
