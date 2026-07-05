import type { ToolDeps } from "./record-extraction.js";
import { resolveMeta } from "./record-extraction.js";

export async function handleReply(deps: ToolDeps, params: unknown): Promise<Record<string, unknown>> {
  const { issueId, message } = (params ?? {}) as { issueId?: string; message?: string };
  if (!issueId || !message) return { error: "issueId and message are required" };
  const meta = await resolveMeta(deps, issueId);
  if (!meta) return { error: "issue has no receipt-meta block" };
  const reply = await deps.discord.replyToMessage(meta.discordChannelId, meta.discordMessageId, message);
  if (!reply.ok) return { error: `discord reply failed: ${reply.error}` };
  return { sent: true };
}
