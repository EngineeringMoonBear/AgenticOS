import type { Result } from "../types.js";
import { parseMetaBlock, parseExtractionComment } from "../receipt-meta.js";

export interface DigestIssues {
  listInReview(): Promise<Array<{ id: string; title: string; description: string }>>;
  listComments(issueId: string): Promise<string[]>;
}

export interface DigestDiscord {
  dmUser(userId: string, content: string): Promise<Result<unknown>>;
}

export interface DigestArchive {
  presignGet(key: string, expiresInSeconds: number): Promise<string>;
}

export async function runDigest(deps: {
  issues: DigestIssues;
  discord: DigestDiscord;
  archive: DigestArchive;
  config: { joshDiscordUserId: string; presignExpirySeconds: number };
  log: (msg: string) => void;
}): Promise<{ receipts: number; sent: boolean }> {
  const pending = await deps.issues.listInReview();
  if (pending.length === 0) return { receipts: 0, sent: false };

  const lines: string[] = [`**🧾 Receipt attach pass — ${pending.length} ready**`, ""];
  for (const issue of pending) {
    const meta = parseMetaBlock(issue.description);
    const comments = await deps.issues.listComments(issue.id);
    const extraction = comments.map(parseExtractionComment).filter((x) => x !== null).at(-1) ?? null;
    if (!meta || !extraction) {
      lines.push(`- ⚠️ ${issue.title} — needs attention (missing metadata or extraction)`);
      continue;
    }
    const link = await deps.archive.presignGet(meta.spacesKey, deps.config.presignExpirySeconds);
    const cash = extraction.payment_method === "cash" ? " · **cash — create via Quick Add**" : "";
    const flags = extraction.flags.length ? ` · flags: ${extraction.flags.join(", ")}` : "";
    lines.push(
      `- **${extraction.vendor}** $${extraction.total.toFixed(2)} (${extraction.date}) → ${extraction.suggested_category}${cash}${flags} · [image](${link})`,
    );
  }
  lines.push("", "After attaching in FarmRaise, close each issue in Vista (drag to Done). Skipped items roll into next week.");

  const sent = await deps.discord.dmUser(deps.config.joshDiscordUserId, lines.join("\n"));
  if (!sent.ok) {
    deps.log(`digest: DM failed: ${sent.error}`);
    return { receipts: pending.length, sent: false };
  }
  return { receipts: pending.length, sent: true };
}
