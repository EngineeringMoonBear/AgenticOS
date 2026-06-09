import type { VikingClient } from "../viking-client.js";

export async function handleMemoryStats(
  client: VikingClient,
): Promise<Record<string, unknown>> {
  const result = await client.stats();
  if (!result.ok) return { error: result.error };
  return result.data;
}
