import type { VikingClient } from "../viking-client.js";

export interface AbstractInput {
  memoryIds: string[];
  targetLevel?: "L1" | "L2";
}

export async function handleAbstract(
  client: VikingClient,
  input: AbstractInput,
): Promise<Record<string, unknown>> {
  const result = await client.abstract(input.memoryIds);
  if (!result.ok) return { error: result.error };
  return result.data;
}
