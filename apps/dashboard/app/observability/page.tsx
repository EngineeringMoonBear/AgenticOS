"use client";

import { useFilter } from "@/lib/filter/use-filter";
import { LiveRunsStrip } from "@/components/observability/live-runs-strip";
import { RunFeed } from "@/components/observability/run-feed";
import { MetricsSidebar } from "@/components/observability/metrics-sidebar";

export default function ObservabilityPage() {
  const { tags, clear } = useFilter();
  const filterActive = tags.length > 0;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Live runs strip — shows currently running runs */}
      <LiveRunsStrip />

      {/* Main area */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Run feed (~70% width) */}
        <RunFeed
          filterActive={filterActive}
          filterTags={tags}
          onClearFilter={clear}
        />

        {/* Right sidebar (~280px) */}
        <MetricsSidebar
          filterActive={filterActive}
        />
      </div>
    </div>
  );
}
