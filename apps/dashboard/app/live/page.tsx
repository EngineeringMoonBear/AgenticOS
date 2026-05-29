import { LiveRunsStrip } from "@/components/observability/live-runs-strip";
import { RateLimitsPanel } from "@/components/observability/RateLimitsPanel";
import { QueueDepthPanel } from "@/components/observability/QueueDepthPanel";
import { RecentErrorsPanel } from "@/components/observability/RecentErrorsPanel";
import { CostBurndownChart } from "@/components/observability/CostBurndownChart";
import { LiveRunFeedSection } from "./live-run-feed-section";

export default function LiveOpsPage() {
  return (
    <div className="grid grid-cols-12 gap-4 p-4">
      <section className="col-span-12">
        <LiveRunsStrip />
      </section>
      <section className="col-span-12 lg:col-span-8">
        <CostBurndownChart />
      </section>
      <section className="col-span-12 lg:col-span-4">
        <RateLimitsPanel />
      </section>
      <section className="col-span-12 lg:col-span-6">
        <QueueDepthPanel />
      </section>
      <section className="col-span-12 lg:col-span-6">
        <RecentErrorsPanel />
      </section>
      <section className="col-span-12">
        <LiveRunFeedSection />
      </section>
    </div>
  );
}
