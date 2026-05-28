import { CostBurndownChart } from "@/components/observability/CostBurndownChart";

export default function CostPage() {
  return (
    <div className="grid grid-cols-12 gap-4 p-4">
      <section className="col-span-12 lg:col-span-8">
        <CostBurndownChart />
      </section>
    </div>
  );
}
