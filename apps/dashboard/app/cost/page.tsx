import { AgentsPanel } from "@/components/observability/AgentsPanel";
import { CostBurndownChart } from "@/components/observability/CostBurndownChart";
import { CostProjectionPanel } from "@/components/observability/CostProjectionPanel";
import { IssuesPanel } from "@/components/observability/IssuesPanel";
import { OpenAICodexPanel } from "@/components/observability/OpenAICodexPanel";
import { OrgPanel } from "@/components/observability/OrgPanel";
import { RoutinesPanel } from "@/components/observability/RoutinesPanel";
import { CostVista } from "@/components/shell/CostVista";

export default function CostPage() {
  return (
    <>
      <CostVista />
      <div className="grid grid-cols-12 gap-4 p-4">
        <section className="col-span-12 md:col-span-6 lg:col-span-4">
          <CostBurndownChart />
        </section>
        <section className="col-span-12 md:col-span-6 lg:col-span-4">
          <CostProjectionPanel />
        </section>
        <section className="col-span-12 md:col-span-6 lg:col-span-4">
          <OpenAICodexPanel />
        </section>
        <section className="col-span-12 md:col-span-6 lg:col-span-4">
          <AgentsPanel />
        </section>
        <section className="col-span-12 md:col-span-6 lg:col-span-4">
          <IssuesPanel />
        </section>
        <section className="col-span-12 md:col-span-6 lg:col-span-4">
          <RoutinesPanel />
        </section>
        <section className="col-span-12 md:col-span-6 lg:col-span-4">
          <OrgPanel />
        </section>
      </div>
    </>
  );
}
