import type { ToolDeps } from "./record-extraction.js";
import { resolveMeta } from "./record-extraction.js";

export async function handleRequestRetake(deps: ToolDeps, params: unknown): Promise<Record<string, unknown>> {
  const { issueId, reason } = (params ?? {}) as { issueId?: string; reason?: string };
  if (!issueId || !reason) return { error: "issueId and reason are required" };
  const meta = await resolveMeta(deps, issueId);
  if (!meta) return { error: "issue has no receipt-meta block" };
  const reply = await deps.discord.replyToMessage(
    meta.discordChannelId,
    meta.discordMessageId,
    `📷 I couldn't read this receipt — ${reason}. Mind posting another shot (flat, all four corners visible)?`,
  );
  if (!reply.ok) return { error: `discord reply failed: ${reply.error}` };
  await deps.issues.setStatus(issueId, "blocked");
  return { requested: true };
}
