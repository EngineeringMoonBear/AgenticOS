import type { VikingClient } from "../viking-client.js";

export interface RememberInput {
  text: string;
  category?: string;
  tags?: string[];
  metadata?: Record<string, string>;
}

export async function handleRemember(
  client: VikingClient,
  input: RememberInput,
): Promise<Record<string, unknown>> {
  const { text, ...metadata } = input;
  const result = await client.remember(text, metadata);
  if (!result.ok) return { error: result.error };
  return result.data;
}
