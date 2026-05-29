"use client";

import { Activity } from "lucide-react";

interface RetrievalTrajectoryGraphProps {
  uri: string;
}

/**
 * Placeholder for the retrieval-trajectory graph view in the Memory tab's
 * DetailView "Trace usage" pane. The real visualization (force-directed graph
 * derived from `useTrajectory(uri)`) ships in Phase 5.
 */
export function RetrievalTrajectoryGraph({ uri }: RetrievalTrajectoryGraphProps) {
  return (
    <div
      role="region"
      aria-label="Retrieval trajectory"
      className="flex flex-col items-center justify-center gap-2 py-8 text-center"
      style={{ color: "var(--text-muted)" }}
    >
      <Activity size={20} aria-hidden="true" style={{ color: "var(--sage)" }} />
      <p className="text-[13px]">
        Trajectory for{" "}
        <span style={{ color: "var(--text-secondary)" }}>{uri || "—"}</span>
      </p>
      <p className="text-[12px]">Implemented in Phase 5.</p>
    </div>
  );
}

export default RetrievalTrajectoryGraph;
