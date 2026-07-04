import { describe, it, expect } from "vitest";
import { runIngest } from "../src/ingest/job.js";
import type { DiscordMessage } from "../src/discord-client.js";

const CFG = {
  receiptsChannelId: "chan",
  presignExpirySeconds: 604800,
} as const;

function msg(id: string, attachments: Array<{ id: string; filename: string; content_type?: string }>): DiscordMessage {
  return {
    id, channel_id: "chan",
    author: { id: "u1", username: "hannah" },
    content: "", timestamp: "2026-07-02T15:04:05Z",
    attachments: attachments.map((a) => ({ ...a, size: 10, url: `https://cdn/${a.id}` })),
  };
}

function makeFakes(messages: DiscordMessage[]) {
  const created: Array<{ title: string; description: string }> = [];
  const existing = new Set<string>();
  let cursor: string | null = null;
  const deps = {
    discord: {
      fetchMessagesAfter: async () => ({ ok: true as const, data: messages }),
      downloadAttachment: async () => ({ ok: true as const, data: new Uint8Array([1]) }),
    },
    archive: {
      put: async () => undefined,
      presignGet: async (key: string) => `https://signed/${key}`,
    },
    issues: {
      existsByOrigin: async (originId: string) => existing.has(originId),
      createReceiptIssue: async (input: { title: string; description: string }) => {
        created.push(input);
        return { id: `issue-${created.length}` };
      },
    },
    state: {
      getCursor: async () => cursor,
      setCursor: async (id: string) => void (cursor = id),
    },
    config: CFG,
    log: () => undefined,
  };
  return { deps, created, existing, cursorRef: () => cursor };
}

describe("runIngest", () => {
  it("creates one issue per image attachment and advances the cursor", async () => {
    const { deps, created, cursorRef } = makeFakes([
      msg("10", [{ id: "a", filename: "r1.jpg", content_type: "image/jpeg" }]),
      msg("11", [
        { id: "b", filename: "r2.jpg", content_type: "image/jpeg" },
        { id: "c", filename: "r3.pdf", content_type: "application/pdf" },
      ]),
    ]);
    const summary = await runIngest(deps);
    expect(summary).toMatchObject({ created: 3, failed: 0 });
    expect(created[0]!.description).toContain("receipt-meta v1");
    expect(created[0]!.description).toContain("https://signed/");
    expect(cursorRef()).toBe("11");
  });

  it("skips already-ingested attachments via originId", async () => {
    const { deps, existing, created } = makeFakes([msg("10", [{ id: "a", filename: "r.jpg", content_type: "image/jpeg" }])]);
    existing.add("10:a");
    const summary = await runIngest(deps);
    expect(summary.skippedDuplicates).toBe(1);
    expect(created).toHaveLength(0);
  });

  it("ignores non-image, non-pdf attachments", async () => {
    const { deps, created } = makeFakes([msg("10", [{ id: "a", filename: "notes.txt", content_type: "text/plain" }])]);
    const summary = await runIngest(deps);
    expect(summary.skippedNonImages).toBe(1);
    expect(created).toHaveLength(0);
  });

  it("does NOT advance cursor past a message whose issue creation failed", async () => {
    const { deps, cursorRef } = makeFakes([
      msg("10", [{ id: "a", filename: "r1.jpg", content_type: "image/jpeg" }]),
      msg("11", [{ id: "b", filename: "r2.jpg", content_type: "image/jpeg" }]),
    ]);
    deps.issues.createReceiptIssue = async (input: { title: string }) => {
      if (input.title.includes("11")) throw new Error("db down");
      return { id: "issue-1" };
    };
    const summary = await runIngest(deps);
    expect(summary.failed).toBe(1);
    expect(cursorRef()).toBe("10"); // stopped before the failing message
  });

  it("skips bot-authored messages (its own replies)", async () => {
    const m = msg("10", [{ id: "a", filename: "r.jpg", content_type: "image/jpeg" }]);
    m.author.bot = true;
    const { deps, created, cursorRef } = makeFakes([m]);
    await runIngest(deps);
    expect(created).toHaveLength(0);
    expect(cursorRef()).toBe("10"); // still consume it
  });
});
