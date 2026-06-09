import type { VikingClient } from "../viking-client.js";

export interface FindInput {
  path: string;
}

export async function handleFind(
  client: VikingClient,
  input: FindInput,
): Promise<Record<string, unknown>> {
  const result = await client.find(input.path);
  if (!result.ok) return { error: result.error };
  return result.data;
}
