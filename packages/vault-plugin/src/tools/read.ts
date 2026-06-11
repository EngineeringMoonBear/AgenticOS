import type { VaultClient } from "../vault-client.js";

export interface ReadInput {
  path: string;
}

export async function handleRead(
  client: VaultClient,
  input: ReadInput,
): Promise<Record<string, unknown>> {
  const result = await client.getPage(input.path);
  if (!result.ok) return { error: result.error };
  return { ...result.data };
}
