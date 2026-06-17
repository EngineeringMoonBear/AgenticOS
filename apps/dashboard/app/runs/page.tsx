import { LiveRunsStrip } from "@/components/observability/live-runs-strip";
import { LiveRunsPanel } from "@/components/observability/LiveRunsPanel";
import { QueueDepthPanel } from "@/components/observability/QueueDepthPanel";
import { RecentErrorsPanel } from "@/components/observability/RecentErrorsPanel";
import { ScheduledRunsPanel } from "@/components/observability/ScheduledRunsPanel";
import { VaultIngestPanel } from "@/components/observability/VaultIngestPanel";
import { RunsVista } from "@/components/shell/RunsVista";
import { LiveRunFeedSection } from "./live-run-feed-section";
import { dataSource } from "@/lib/config/data-source";

export default function LiveOpsPage() {
  return (
    <>
    <RunsVista />
    <div className="grid grid-cols-12 gap-4 p-4">
      <section className="col-span-12">
        <LiveRunsStrip />
      </section>
      <section className="col-span-12 md:col-span-6 lg:col-span-4">
        <VaultIngestPanel />
      </section>
      <section className="col-span-12 md:col-span-6 lg:col-span-4">
        {/* Cancel button is hidden on the Paperclip path: the Hermes DELETE
            endpoint it targets does not exist on Paperclip. The native cancel
            endpoint will be wired in the run-control follow-up FR. */}
        <LiveRunsPanel showCancelButton={dataSource() !== "paperclip"} />
      </section>
      <section className="col-span-12 md:col-span-6 lg:col-span-4">
        <QueueDepthPanel />
      </section>
      <section className="col-span-12 md:col-span-6 lg:col-span-4">
        <ScheduledRunsPanel />
      </section>
      <section className="col-span-12 lg:col-span-6">
        {/* Retry button is hidden on the Paperclip path — the Hermes retry
            endpoint it targets does not exist in Paperclip. */}
        <RecentErrorsPanel showRetryButton={dataSource() !== "paperclip"} />
      </section>
      <section className="col-span-12">
        <LiveRunFeedSection />
      </section>
    </div>
    </>
  );
}
