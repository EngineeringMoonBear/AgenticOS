import type { VaultClient } from "../vault-client.js";

export async function handleStats(
  client: VaultClient,
): Promise<Record<string, unknown>> {
  const result = await client.getStats();
  if (!result.ok) return { error: result.error };
  return result.data;
}
