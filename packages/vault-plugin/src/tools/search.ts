import type { VaultClient } from "../vault-client.js";

export interface SearchInput {
  query: string;
  limit?: number;
  tags?: string[];
}

export async function handleSearch(
  client: VaultClient,
  input: SearchInput,
): Promise<Record<string, unknown>> {
  const result = await client.search(input.query, {
    limit: input.limit,
    tags: input.tags,
  });
  if (!result.ok) return { error: result.error };
  return { results: result.data.results, total: result.data.total };
}
