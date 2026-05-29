"use client";
import { RunFeed } from "@/components/observability/run-feed";

export function LiveRunFeedSection() {
  return (
    <RunFeed
      filterActive={false}
      filterTags={[]}
      onClearFilter={() => {}}
    />
  );
}
