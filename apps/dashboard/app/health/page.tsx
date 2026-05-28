import { AgentHealthPanel } from "@/components/observability/AgentHealthPanel";
import { BackupsPanel } from "@/components/observability/BackupsPanel";
import { ExternalServicesPanel } from "@/components/observability/ExternalServicesPanel";
import { SystemResourcesPanel } from "@/components/observability/SystemResourcesPanel";

export default function HealthPage() {
  return (
    <div className="grid grid-cols-12 gap-4 p-4">
      <section className="col-span-12 md:col-span-6 lg:col-span-3">
        <AgentHealthPanel />
      </section>
      <section className="col-span-12 md:col-span-6 lg:col-span-3">
        <SystemResourcesPanel />
      </section>
      <section className="col-span-12 md:col-span-6 lg:col-span-3">
        <ExternalServicesPanel />
      </section>
      <section className="col-span-12 md:col-span-6 lg:col-span-3">
        <BackupsPanel />
      </section>
    </div>
  );
}
