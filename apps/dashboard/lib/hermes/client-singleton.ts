import "server-only";
import { HermesClient } from "@agenticos/hermes-client";
import { readConfig } from "@/lib/config/config-io";

let cached: HermesClient | null = null;

export async function getHermesClient(): Promise<HermesClient> {
  if (cached) return cached;
  const cfg = await readConfig();
  cached = new HermesClient({ baseUrl: cfg.hermesUrl });
  return cached;
}

// For tests only.
export function __resetHermesClientForTests(): void {
  cached = null;
}
