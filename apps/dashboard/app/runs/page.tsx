import { LiveRunsStrip } from "@/components/observability/live-runs-strip";
import { RateLimitsPanel } from "@/components/observability/RateLimitsPanel";
import { LiveRunsPanel } from "@/components/observability/LiveRunsPanel";
import { RecentErrorsPanel } from "@/components/observability/RecentErrorsPanel";
import { LiveRunFeedSection } from "./live-run-feed-section";

export default function LiveOpsPage() {
  return (
    <div className="grid grid-cols-12 gap-4 p-4">
      <section className="col-span-12">
        <LiveRunsStrip />
      </section>
      <section className="col-span-12 lg:col-span-6">
        <LiveRunsPanel />
      </section>
      <section className="col-span-12 lg:col-span-6">
        <RecentErrorsPanel />
      </section>
      <section className="col-span-12 lg:col-span-6">
        <RateLimitsPanel />
      </section>
      <section className="col-span-12">
        <LiveRunFeedSection />
      </section>
    </div>
  );
}
