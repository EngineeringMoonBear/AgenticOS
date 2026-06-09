import type { VaultClient } from "../vault-client.js";

export interface DiscardInput {
  path: string;
}

export async function handleDiscard(
  client: VaultClient,
  input: DiscardInput,
): Promise<Record<string, unknown>> {
  const result = await client.discardInboxItem(input.path);
  if (!result.ok) return { error: result.error };
  return result.data;
}
