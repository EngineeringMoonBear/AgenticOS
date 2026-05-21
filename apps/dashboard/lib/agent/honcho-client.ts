import "server-only";
import { Honcho } from "@honcho-ai/sdk";

let cached: Honcho | null = null;

export function getHonchoClient(): Honcho {
  if (cached) return cached;
  const baseURL = process.env.HONCHO_URL;
  if (!baseURL) {
    throw new Error("HONCHO_URL environment variable is required");
  }
  cached = new Honcho({
    baseURL,
    workspaceId: process.env.HONCHO_WORKSPACE_ID ?? "agenticos",
  });
  return cached;
}

export function resetHonchoClientForTests(): void {
  cached = null;
}
