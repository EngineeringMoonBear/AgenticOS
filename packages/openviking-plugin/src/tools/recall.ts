import type { VikingClient } from "../viking-client.js";

export interface RecallInput {
  query: string;
  limit?: number;
  category?: string;
}

export async function handleRecall(
  client: VikingClient,
  input: RecallInput,
): Promise<Record<string, unknown>> {
  const result = await client.recall(input.query, {
    limit: input.limit,
    category: input.category,
  });
  if (!result.ok) return { error: result.error };
  return result.data;
}
