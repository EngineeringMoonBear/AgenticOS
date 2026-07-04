import type { Result } from "../types.js";
import { parseMetaBlock, parseExtractionComment } from "../receipt-meta.js";

const MAX_DM_CHARS = 1900; // headroom under Discord's 2000-char hard cap

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

/** Pack header + receipt lines + footer into DM-sized pages. Exported for tests. */
export function paginateDigest(header: string, receiptLines: string[], footer: string): string[] {
  const pages: string[] = [];
  let current = header;
  for (const line of receiptLines) {
    const candidate = `${current}\n${line}`;
    if (candidate.length > MAX_DM_CHARS) {
      pages.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  const withFooter = `${current}\n\n${footer}`;
  if (withFooter.length > MAX_DM_CHARS) {
    pages.push(current);
    pages.push(footer);
  } else {
    pages.push(withFooter);
  }
  return pages;
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

  const header = `**🧾 Receipt attach pass — ${pending.length} ready**`;
  const footer = "After attaching in FarmRaise, close each issue in Vista (drag to Done). Skipped items roll into next week.";
  const receiptLines: string[] = [];

  for (const issue of pending) {
    const meta = parseMetaBlock(issue.description);
    const comments = await deps.issues.listComments(issue.id);
    const extraction = comments.map(parseExtractionComment).filter((x) => x !== null).at(-1) ?? null;
    if (!meta || !extraction) {
      receiptLines.push(`- ⚠️ ${issue.title} — needs attention (missing metadata or extraction)`);
      continue;
    }
    const link = await deps.archive.presignGet(meta.spacesKey, deps.config.presignExpirySeconds);
    const cash = extraction.payment_method === "cash" ? " · **cash — create via Quick Add**" : "";
    const flags = extraction.flags.length ? ` · flags: ${extraction.flags.join(", ")}` : "";
    receiptLines.push(
      `- **${extraction.vendor}** $${extraction.total.toFixed(2)} (${extraction.date}) → ${extraction.suggested_category}${cash}${flags} · [image](${link})`,
    );
  }

  const pages = paginateDigest(header, receiptLines, footer);
  for (const [i, page] of pages.entries()) {
    const sent = await deps.discord.dmUser(deps.config.joshDiscordUserId, page);
    if (!sent.ok) {
      deps.log(`digest: DM page ${i + 1}/${pages.length} failed: ${sent.error}`);
      return { receipts: pending.length, sent: false };
    }
  }
  return { receipts: pending.length, sent: true };
}
