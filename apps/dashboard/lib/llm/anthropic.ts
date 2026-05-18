import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { readConfig } from "@/lib/config/config-io";

let client: Anthropic | null = null;

/**
 * Lazy-init Anthropic client. Throws if ANTHROPIC_API_KEY is not set.
 */
export function getAnthropic(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is required but not set. " +
        "Set it before starting the dashboard server."
    );
  }
  client = new Anthropic({ apiKey });
  return client;
}

/**
 * Returns the configured Sonnet model ID from settings.
 */
export async function getSonnetModelId(): Promise<string> {
  const cfg = await readConfig();
  return cfg.modelDefaults.sonnet;
}

/**
 * Reset singleton — for tests only.
 */
export function __resetAnthropicClientForTests(): void {
  client = null;
}
