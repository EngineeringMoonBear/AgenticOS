import type { Result, ReceiptExtraction, ReceiptMeta } from "../types.js";
import { parseMetaBlock, renderExtractionComment } from "../receipt-meta.js";

export interface ToolDeps {
  issues: {
    getDescription(issueId: string): Promise<string | null>;
    createComment(issueId: string, body: string): Promise<void>;
    setStatus(issueId: string, status: "in_review" | "blocked" | "cancelled"): Promise<void>;
  };
  discord: {
    replyToMessage(channelId: string, messageId: string, content: string): Promise<Result<unknown>>;
    react(channelId: string, messageId: string, emoji: string): Promise<Result<void>>;
  };
  archive: { putJson(key: string, value: unknown): Promise<void> };
  log: (msg: string) => void;
}

export async function resolveMeta(deps: ToolDeps, issueId: string): Promise<ReceiptMeta | null> {
  const description = await deps.issues.getDescription(issueId);
  return description ? parseMetaBlock(description) : null;
}

function validateExtraction(raw: unknown): ReceiptExtraction | string {
  if (typeof raw !== "object" || raw === null) return "extraction must be an object";
  const x = raw as Record<string, unknown>;
  if (typeof x.vendor !== "string" || x.vendor.length === 0) return "vendor must be a non-empty string";
  if (typeof x.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x.date)) return "date must be YYYY-MM-DD";
  if (typeof x.total !== "number" || !(x.total > 0)) return "total must be a positive number";
  if (!["card", "cash", "check", "unknown"].includes(x.payment_method as string)) return "invalid payment_method";
  if (typeof x.suggested_category !== "string" || x.suggested_category.length === 0) return "suggested_category required";
  if (typeof x.confidence !== "number" || x.confidence < 0 || x.confidence > 1) return "confidence must be 0..1";
  if (!Array.isArray(x.flags)) return "flags must be an array";
  if (!Array.isArray(x.line_items)) return "line_items must be an array";
  return { ...(x as unknown as ReceiptExtraction), v: 1 };
}

export async function handleRecordExtraction(deps: ToolDeps, params: unknown): Promise<Record<string, unknown>> {
  const { issueId, extraction: raw } = (params ?? {}) as { issueId?: string; extraction?: unknown };
  if (!issueId) return { error: "issueId is required" };
  const validated = validateExtraction(raw);
  if (typeof validated === "string") return { error: `invalid extraction: ${validated}` };
  const meta = await resolveMeta(deps, issueId);
  if (!meta) return { error: "issue has no receipt-meta block — is this a receipt issue?" };

  await deps.archive.putJson(`${meta.spacesKey}.json`, validated);
  await deps.issues.createComment(issueId, renderExtractionComment(validated));
  const cashNote = validated.payment_method === "cash" ? " (cash — will need Quick Add, not just attach)" : "";
  const reply = await deps.discord.replyToMessage(
    meta.discordChannelId,
    meta.discordMessageId,
    `✅ ${validated.vendor} — $${validated.total.toFixed(2)} on ${validated.date} → **${validated.suggested_category}**${cashNote}. Pending Josh's review.`,
  );
  if (!reply.ok) deps.log(`record-extraction: discord reply failed: ${reply.error}`);
  await deps.issues.setStatus(issueId, "in_review");
  return { recorded: true, sidecar: `${meta.spacesKey}.json` };
}
