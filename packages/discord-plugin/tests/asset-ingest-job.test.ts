import { describe, it, expect } from "vitest";
import { runAssetIngest } from "../src/assets/job.js";
import type { DiscordMessage } from "../src/discord-client.js";

const CFG = { assetsChannelId: "assets" } as const;

function msg(
  id: string,
  content: string,
  attachments: Array<{ id: string; filename: string; content_type?: string }>,
  opts: { bot?: boolean } = {},
): DiscordMessage {
  return {
    id,
    channel_id: "assets",
    author: { id: "u1", username: "wesley", bot: opts.bot },
    content,
    timestamp: "2026-07-08T15:04:05Z",
    attachments: attachments.map((a) => ({ ...a, size: 10, url: `https://cdn/${a.id}` })),
  };
}

function makeFakes(messages: DiscordMessage[]) {
  const uploads: Array<{ brand: string; assetClass: string; slug: string; filename: string }> = [];
  const brandPrs: Array<{ brand: string; slug: string }> = [];
  const replies: Array<{ messageId: string; content: string }> = [];
  let cursor: string | null = null;

  const deps = {
    discord: {
      fetchMessagesAfter: async () => ({ ok: true as const, data: messages }),
      downloadAttachment: async () => ({ ok: true as const, data: new Uint8Array([1, 2, 3]) }),
      replyToMessage: async (_c: string, messageId: string, content: string) => {
        replies.push({ messageId, content });
        return { ok: true as const, data: undefined };
      },
    },
    pipeline: {
      optimizeAndUpload: async (input: { brand: string; assetClass: string; slug: string; filename: string }) => {
        uploads.push({
          brand: input.brand,
          assetClass: input.assetClass,
          slug: input.slug,
          filename: input.filename,
        });
        const key = `${input.brand}/${input.assetClass}/${input.slug}.abc123.webp`;
        return { cdnUrl: `https://cdn.example/${key}`, key };
      },
    },
    brand: {
      proposeBrandEntry: async (input: { brand: string; slug: string }) => {
        brandPrs.push({ brand: input.brand, slug: input.slug });
        return { prUrl: `https://github.com/Goldberry-Playground/grove-sites/pull/999` };
      },
    },
    state: {
      getCursor: async () => cursor,
      setCursor: async (id: string) => void (cursor = id),
    },
    config: CFG,
    log: () => undefined,
  };
  return { deps, uploads, brandPrs, replies, cursorRef: () => cursor };
}

describe("runAssetIngest", () => {
  it("optimizes+uploads an image and replies with the CDN URL", async () => {
    const { deps, uploads, replies, cursorRef } = makeFakes([
      msg("10", "goldberry, hero, orchard at dusk", [
        { id: "a", filename: "shot.jpg", content_type: "image/jpeg" },
      ]),
    ]);
    const summary = await runAssetIngest(deps);
    expect(summary).toMatchObject({ scanned: 1, uploaded: 1, brandPrs: 0, failed: 0 });
    expect(uploads[0]).toMatchObject({ brand: "goldberry", assetClass: "hero", slug: "orchard-at-dusk" });
    expect(replies[0]!.content).toContain("https://cdn.example/goldberry/hero/orchard-at-dusk");
    expect(cursorRef()).toBe("10");
  });

  it("routes a logo to the @grove/brand PR path instead of a plain CDN reply", async () => {
    const { deps, brandPrs, replies } = makeFakes([
      msg("11", "ggg, logo, main mark", [{ id: "b", filename: "logo.png", content_type: "image/png" }]),
    ]);
    const summary = await runAssetIngest(deps);
    expect(summary).toMatchObject({ uploaded: 0, brandPrs: 1 });
    expect(brandPrs[0]).toMatchObject({ brand: "ggg", slug: "main-mark" });
    expect(replies[0]!.content).toContain("@grove/brand");
    expect(replies[0]!.content).toContain("/pull/999");
  });

  it("replies with a hint and skips when the caption is invalid", async () => {
    const { deps, uploads, replies } = makeFakes([
      msg("12", "not a valid caption", [{ id: "c", filename: "x.jpg", content_type: "image/jpeg" }]),
    ]);
    const summary = await runAssetIngest(deps);
    expect(summary).toMatchObject({ invalidCaptions: 1, uploaded: 0 });
    expect(uploads).toHaveLength(0);
    expect(replies[0]!.content).toContain("Caption");
  });

  it("skips bot messages and non-image attachments, still advancing the cursor", async () => {
    const { deps, uploads, cursorRef } = makeFakes([
      msg("13", "goldberry, hero, x", [{ id: "d", filename: "notes.pdf", content_type: "application/pdf" }]),
      msg("14", "goldberry, hero, y", [{ id: "e", filename: "a.jpg", content_type: "image/jpeg" }], { bot: true }),
    ]);
    const summary = await runAssetIngest(deps);
    expect(summary).toMatchObject({ skippedNonImages: 1, uploaded: 0 });
    expect(uploads).toHaveLength(0);
    expect(cursorRef()).toBe("14");
  });

  it("uploads every image in a multi-attachment message under one caption", async () => {
    const { deps, uploads, replies } = makeFakes([
      msg("15", "nursery, gallery, spring stock", [
        { id: "f", filename: "1.jpg", content_type: "image/jpeg" },
        { id: "g", filename: "2.jpg", content_type: "image/jpeg" },
      ]),
    ]);
    const summary = await runAssetIngest(deps);
    expect(summary).toMatchObject({ uploaded: 2 });
    expect(uploads.map((u) => u.filename)).toEqual(["1.jpg", "2.jpg"]);
    expect(replies).toHaveLength(2);
  });

  it("does NOT advance the cursor when upload fails, so the next run retries", async () => {
    const { deps, cursorRef } = makeFakes([
      msg("16", "goldberry, hero, boom", [{ id: "h", filename: "b.jpg", content_type: "image/jpeg" }]),
    ]);
    deps.pipeline.optimizeAndUpload = async () => {
      throw new Error("spaces 500");
    };
    const summary = await runAssetIngest(deps);
    expect(summary).toMatchObject({ failed: 1, uploaded: 0 });
    expect(cursorRef()).toBeNull();
  });

  it("reports a discord fetch failure as failed without throwing", async () => {
    const { deps } = makeFakes([]);
    deps.discord.fetchMessagesAfter = async () => ({ ok: false as const, error: "429" });
    const summary = await runAssetIngest(deps);
    expect(summary).toMatchObject({ failed: 1, scanned: 0 });
  });
});
