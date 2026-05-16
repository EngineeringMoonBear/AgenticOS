"use client";

import { Activity } from "lucide-react";
import type { Run } from "@/lib/fixtures/runs";
import { RunCard } from "@/components/runs/run-card";

interface RunFeedProps {
  runs: Run[];
  filterActive: boolean;
  filterTags: string[];
  onClearFilter: () => void;
}

export function RunFeed({
  runs,
  filterActive,
  filterTags,
  onClearFilter,
}: RunFeedProps) {
  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-3 py-24">
        <Activity
          size={40}
          strokeWidth={1.5}
          style={{ color: "var(--text-muted)" }}
        />
        {filterActive ? (
          <>
            <p
              className="text-sm text-center"
              style={{ color: "var(--text-muted)" }}
            >
              No runs tagged {filterTags.map((t) => `#${t}`).join(", ")}.
            </p>
            <button
              type="button"
              onClick={onClearFilter}
              className="text-xs underline transition-colors"
              style={{ color: "var(--accent-plum-400)" }}
            >
              Clear filter
            </button>
          </>
        ) : (
          <p
            className="text-sm text-center"
            style={{ color: "var(--text-muted)" }}
          >
            No runs in this project. Dispatch a skill from Architecture to see
            activity here.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 p-4 overflow-y-auto flex-1 min-h-0">
      {runs.map((run) => (
        <RunCard key={run.id} run={run} />
      ))}
    </div>
  );
}
