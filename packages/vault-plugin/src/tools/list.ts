import type { VaultClient } from "../vault-client.js";

export async function handleList(
  client: VaultClient,
): Promise<Record<string, unknown>> {
  const result = await client.listPages();
  if (!result.ok) return { error: result.error };
  return { paths: result.data.flatPaths };
}
