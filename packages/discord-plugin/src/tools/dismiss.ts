import type { ToolDeps } from "./record-extraction.js";
import { resolveMeta } from "./record-extraction.js";

export async function handleDismiss(deps: ToolDeps, params: unknown): Promise<Record<string, unknown>> {
  const { issueId, reason } = (params ?? {}) as { issueId?: string; reason?: string };
  if (!issueId || !reason) return { error: "issueId and reason are required" };
  const meta = await resolveMeta(deps, issueId);
  if (!meta) return { error: "issue has no receipt-meta block" };
  const react = await deps.discord.react(meta.discordChannelId, meta.discordMessageId, "🤷");
  if (!react.ok) deps.log(`dismiss: react failed: ${react.error}`);
  await deps.issues.setStatus(issueId, "cancelled");
  return { dismissed: true, reason };
}
