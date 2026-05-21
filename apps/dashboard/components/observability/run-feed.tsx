"use client";

import { Activity } from "lucide-react";
import { useRunFeed } from "@/lib/hooks/use-run-feed";
import { RunCard } from "@/components/runs/run-card";

interface RunFeedProps {
  filterActive: boolean;
  filterTags: string[];
  onClearFilter: () => void;
}

export function RunFeed({
  filterActive,
  filterTags,
  onClearFilter,
}: RunFeedProps) {
  const { data: runs, isLoading } = useRunFeed({ limit: 50 });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-3 py-24">
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>Loading runs…</div>
      </div>
    );
  }

  const filteredRuns = filterActive && filterTags.length > 0
    ? (runs ?? []).filter((run) =>
        filterTags.every((tag) => ((run as { tags?: string[] }).tags ?? []).includes(tag)),
      )
    : (runs ?? []);

  if (filteredRuns.length === 0) {
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
            No runs yet. Dispatch a skill from /architecture to see it here.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 p-4 overflow-y-auto flex-1 min-h-0">
      {filteredRuns.map((run) => (
        <RunCard key={run.id} run={run} />
      ))}
    </div>
  );
}
