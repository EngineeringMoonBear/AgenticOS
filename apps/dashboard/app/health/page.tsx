import { AgentHealthPanel } from "@/components/observability/AgentHealthPanel";
import { ExternalServicesPanel } from "@/components/observability/ExternalServicesPanel";
import { SystemResourcesPanel } from "@/components/observability/SystemResourcesPanel";
import { HealthVista } from "@/components/shell/HealthVista";

export default function HealthPage() {
  return (
    <>
      <HealthVista />
      <div className="grid grid-cols-12 gap-4 p-4">
        <section className="col-span-12 md:col-span-6 lg:col-span-4">
          <AgentHealthPanel />
        </section>
        <section className="col-span-12 md:col-span-6 lg:col-span-4">
          <SystemResourcesPanel />
        </section>
        <section className="col-span-12 md:col-span-6 lg:col-span-4">
          <ExternalServicesPanel />
        </section>
      </div>
    </>
  );
}
