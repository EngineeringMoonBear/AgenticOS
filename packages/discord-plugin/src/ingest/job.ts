import type { Result } from "../types.js";
import type { DiscordMessage } from "../discord-client.js";
import { renderMetaBlock } from "../receipt-meta.js";
import { receiptKeyFor } from "../spaces.js";

export interface IngestDiscord {
  fetchMessagesAfter(channelId: string, afterId: string | null): Promise<Result<DiscordMessage[]>>;
  downloadAttachment(url: string): Promise<Result<Uint8Array>>;
}

export interface IngestArchive {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  presignGet(key: string, expiresInSeconds: number): Promise<string>;
}

export interface IngestIssues {
  existsByOrigin(originId: string): Promise<boolean>;
  createReceiptIssue(input: { title: string; description: string }): Promise<{ id: string }>;
}

export interface IngestState {
  getCursor(): Promise<string | null>;
  setCursor(messageId: string): Promise<void>;
}

export interface IngestSummary {
  scanned: number;
  created: number;
  skippedDuplicates: number;
  skippedNonImages: number;
  failed: number;
}

const RECEIPT_CONTENT_TYPES = /^(image\/|application\/pdf)/;

export async function runIngest(deps: {
  discord: IngestDiscord;
  archive: IngestArchive;
  issues: IngestIssues;
  state: IngestState;
  config: { receiptsChannelId: string; presignExpirySeconds: number };
  log: (msg: string) => void;
}): Promise<IngestSummary> {
  const summary: IngestSummary = { scanned: 0, created: 0, skippedDuplicates: 0, skippedNonImages: 0, failed: 0 };
  const cursor = await deps.state.getCursor();
  const fetched = await deps.discord.fetchMessagesAfter(deps.config.receiptsChannelId, cursor);
  if (!fetched.ok) {
    deps.log(`ingest: discord fetch failed: ${fetched.error}`);
    summary.failed += 1;
    return summary;
  }

  for (const message of fetched.data) {
    summary.scanned += 1;
    if (message.author.bot) {
      await deps.state.setCursor(message.id);
      continue;
    }
    try {
      for (const att of message.attachments) {
        if (!RECEIPT_CONTENT_TYPES.test(att.content_type ?? "")) {
          summary.skippedNonImages += 1;
          continue;
        }
        const originId = `${message.id}:${att.id}`;
        if (await deps.issues.existsByOrigin(originId)) {
          summary.skippedDuplicates += 1;
          continue;
        }
        const bytes = await deps.discord.downloadAttachment(att.url);
        if (!bytes.ok) throw new Error(`download ${att.filename}: ${bytes.error}`);
        const key = receiptKeyFor(message.timestamp, message.id, att.id, att.filename);
        await deps.archive.put(key, bytes.data, att.content_type ?? "application/octet-stream");
        const imageUrl = await deps.archive.presignGet(key, deps.config.presignExpirySeconds);
        const meta = {
          v: 1 as const,
          spacesKey: key,
          discordChannelId: message.channel_id,
          discordMessageId: message.id,
          discordAttachmentId: att.id,
          poster: message.author.username,
          postedAt: message.timestamp,
          caption: message.content,
        };
        const description = [
          `Receipt photo posted by **${message.author.username}** in #receipts on ${message.timestamp.slice(0, 10)}.`,
          message.content ? `Caption: "${message.content}"` : "",
          "",
          `Image (presigned, expires in ${Math.round(deps.config.presignExpirySeconds / 86400)}d): ${imageUrl}`,
          "",
          renderMetaBlock(meta),
        ]
          .filter((line) => line !== "")
          .join("\n");
        await deps.issues.createReceiptIssue({
          title: `RCPT ${message.timestamp.slice(0, 10)} from ${message.author.username} (${message.id}/${att.id})`,
          description,
        });
        summary.created += 1;
      }
      await deps.state.setCursor(message.id);
    } catch (err) {
      summary.failed += 1;
      deps.log(`ingest: stopping at message ${message.id}: ${err instanceof Error ? err.message : String(err)}`);
      break; // do not advance cursor; next run retries (originId dedup makes it safe)
    }
  }
  return summary;
}
