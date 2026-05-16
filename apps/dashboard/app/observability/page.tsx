"use client";

import { useMemo } from "react";
import { RUN_FIXTURES } from "@/lib/fixtures/runs";
import { useFilter } from "@/lib/filter/use-filter";
import { LiveRunsStrip } from "@/components/observability/live-runs-strip";
import { RunFeed } from "@/components/observability/run-feed";
import { MetricsSidebar } from "@/components/observability/metrics-sidebar";

// Runs sorted newest-first (largest startedAt timestamp first)
const SORTED_RUNS = [...RUN_FIXTURES].sort(
  (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
);

export default function ObservabilityPage() {
  const { tags, clear } = useFilter();
  const filterActive = tags.length > 0;

  const filteredRuns = useMemo(() => {
    if (!filterActive) return SORTED_RUNS;
    return SORTED_RUNS.filter((r) =>
      r.tags.some((t) => tags.includes(t))
    );
  }, [tags, filterActive]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Live runs strip — narrows with filter */}
      <LiveRunsStrip runs={filteredRuns} />

      {/* Main area */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Run feed (~70% width) */}
        <RunFeed
          runs={filteredRuns}
          filterActive={filterActive}
          filterTags={tags}
          onClearFilter={clear}
        />

        {/* Right sidebar (~280px) */}
        <MetricsSidebar
          filteredRuns={filteredRuns}
          filterActive={filterActive}
        />
      </div>
    </div>
  );
}
