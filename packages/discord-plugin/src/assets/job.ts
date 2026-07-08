/**
 * #assets ingest job (GOL-92 / AgenticOS#251) — the Penny pattern applied to
 * brand asset uploads instead of receipts.
 *
 * Flow per new image in the `#assets` channel:
 *   parse caption → optimize+upload (grove-sites `upload-asset.ts` recipe, injected)
 *     → logo class:  open a `@grove/brand` PR, reply with the PR URL   (ADR-009 Tier 4)
 *     → other class: reply with the CDN URL                            (ADR-009 Tier 3)
 *
 * The optimize/upload step and the brand-PR step are *injected* (`AssetPipeline`,
 * `AssetBrand`) rather than implemented here, for two reasons:
 *   1. The optimize recipe (sharp → responsive webp/avif → content-hash → Spaces)
 *      is owned by grove-sites `upload-asset.ts` (grove-sites #38). Reimplementing
 *      it in the plugin would violate ADR-009's "one optimize pipeline" rule and
 *      drift. This module owns *orchestration*; the recipe binds in when #38 lands.
 *   2. It keeps the whole job unit-testable with fakes — no Spaces creds, no sharp.
 *
 * Cursor/dedup mirrors `runIngest`: advance the cursor after a message is fully
 * handled; on a hard error break WITHOUT advancing so the next run retries.
 * Content-hashed upload keys make re-upload idempotent; the only non-idempotent
 * effect on retry is a duplicate Discord reply, which is acceptable and rare.
 */
import type { Result } from "../types.js";
import type { DiscordMessage } from "../discord-client.js";
import { parseAssetCaption, isLogoClass, descriptionSlug, type ParsedCaption } from "./caption.js";

const IMAGE_CONTENT_TYPE = /^image\//;

export interface AssetDiscord {
  fetchMessagesAfter(channelId: string, afterId: string | null): Promise<Result<DiscordMessage[]>>;
  downloadAttachment(url: string): Promise<Result<Uint8Array>>;
  replyToMessage(channelId: string, messageId: string, content: string): Promise<Result<unknown>>;
}

/** The optimize-and-upload seam — bound to grove-sites `upload-asset.ts` (grove-sites #38). */
export interface AssetPipeline {
  optimizeAndUpload(input: {
    bytes: Uint8Array;
    filename: string;
    brand: string;
    assetClass: string;
    /** kebab slug derived from the caption description; used to name the CDN key */
    slug: string;
  }): Promise<{ cdnUrl: string; key: string }>;
}

/** The `@grove/brand` PR seam (ADR-009 Tier 4). Only invoked for logo-class assets. */
export interface AssetBrand {
  proposeBrandEntry(input: {
    brand: string;
    slug: string;
    cdnUrl: string;
    key: string;
    caption: string;
  }): Promise<{ prUrl: string }>;
}

export interface AssetState {
  getCursor(): Promise<string | null>;
  setCursor(messageId: string): Promise<void>;
}

export interface AssetIngestSummary {
  scanned: number;
  uploaded: number;
  brandPrs: number;
  skippedNonImages: number;
  invalidCaptions: number;
  failed: number;
}

export async function runAssetIngest(deps: {
  discord: AssetDiscord;
  pipeline: AssetPipeline;
  brand: AssetBrand;
  state: AssetState;
  config: { assetsChannelId: string };
  log: (msg: string) => void;
}): Promise<AssetIngestSummary> {
  const summary: AssetIngestSummary = {
    scanned: 0,
    uploaded: 0,
    brandPrs: 0,
    skippedNonImages: 0,
    invalidCaptions: 0,
    failed: 0,
  };

  const cursor = await deps.state.getCursor();
  const fetched = await deps.discord.fetchMessagesAfter(deps.config.assetsChannelId, cursor);
  if (!fetched.ok) {
    deps.log(`asset-ingest: discord fetch failed: ${fetched.error}`);
    summary.failed += 1;
    return summary;
  }

  for (const message of fetched.data) {
    summary.scanned += 1;
    if (message.author.bot) {
      await deps.state.setCursor(message.id);
      continue;
    }

    const images = message.attachments.filter((a) => IMAGE_CONTENT_TYPE.test(a.content_type ?? ""));
    if (message.attachments.length > 0 && images.length === 0) {
      summary.skippedNonImages += message.attachments.length;
    }
    if (images.length === 0) {
      await deps.state.setCursor(message.id);
      continue;
    }

    // The caption applies to the whole message; parse once.
    const parsed = parseAssetCaption(message.content);
    if (!parsed.ok) {
      summary.invalidCaptions += 1;
      await deps.discord.replyToMessage(message.channel_id, message.id, `⚠️ ${parsed.error}`);
      await deps.state.setCursor(message.id);
      continue;
    }

    try {
      for (const att of images) {
        await handleOne(deps, summary, message, att, parsed.value);
      }
      await deps.state.setCursor(message.id);
    } catch (err) {
      summary.failed += 1;
      deps.log(
        `asset-ingest: stopping at message ${message.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      break; // do not advance cursor; next run retries
    }
  }

  return summary;
}

async function handleOne(
  deps: { discord: AssetDiscord; pipeline: AssetPipeline; brand: AssetBrand },
  summary: AssetIngestSummary,
  message: DiscordMessage,
  att: DiscordMessage["attachments"][number],
  parsed: ParsedCaption,
): Promise<void> {
  const bytes = await deps.discord.downloadAttachment(att.url);
  if (!bytes.ok) throw new Error(`download ${att.filename}: ${bytes.error}`);

  const slug = descriptionSlug(parsed);
  const { cdnUrl, key } = await deps.pipeline.optimizeAndUpload({
    bytes: bytes.data,
    filename: att.filename,
    brand: parsed.brand,
    assetClass: parsed.assetClass,
    slug,
  });

  if (isLogoClass(parsed.assetClass)) {
    const { prUrl } = await deps.brand.proposeBrandEntry({
      brand: parsed.brand,
      slug,
      cdnUrl,
      key,
      caption: message.content,
    });
    summary.brandPrs += 1;
    await deps.discord.replyToMessage(
      message.channel_id,
      message.id,
      `🎨 Logo optimized & uploaded, and opened a \`@grove/brand\` PR for **${parsed.brand}/${slug}**: ${prUrl}`,
    );
    return;
  }

  summary.uploaded += 1;
  await deps.discord.replyToMessage(
    message.channel_id,
    message.id,
    `✅ **${parsed.brand}/${parsed.assetClass}** uploaded → ${cdnUrl}`,
  );
}
