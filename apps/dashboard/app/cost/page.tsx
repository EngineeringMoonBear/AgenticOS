import { CostBurndownChart } from "@/components/observability/CostBurndownChart";
import { CostProjectionPanel } from "@/components/observability/CostProjectionPanel";
import { OllamaPanel } from "@/components/observability/OllamaPanel";
import { OpenAICodexPanel } from "@/components/observability/OpenAICodexPanel";
import { RateLimitsPanel } from "@/components/observability/RateLimitsPanel";
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
          <RateLimitsPanel />
        </section>
        <section className="col-span-12 md:col-span-6 lg:col-span-4">
          <OpenAICodexPanel />
        </section>
        <section className="col-span-12 md:col-span-6 lg:col-span-4">
          <OllamaPanel />
        </section>
      </div>
    </>
  );
}
