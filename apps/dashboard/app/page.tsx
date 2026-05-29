import { redirect } from "next/navigation";

const TAB_ROUTES: Record<string, string> = {
  runs: "/runs",
  architecture: "/architecture",
  cost: "/cost",
  health: "/health",
  memory: "/memory",
};

export default async function RootPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  redirect((tab && TAB_ROUTES[tab]) || "/runs");
}
