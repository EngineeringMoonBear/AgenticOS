import { describe, it, expect } from "vitest";
import { handleRecordExtraction, handleRequestRetake, handleDismiss, handleReply } from "../src/tools/index.js";
import { renderMetaBlock } from "../src/receipt-meta.js";
import type { ReceiptMeta } from "../src/types.js";

const meta: ReceiptMeta = {
  v: 1, spacesKey: "receipts/2026/07/x.jpg", discordChannelId: "c1",
  discordMessageId: "m1", discordAttachmentId: "a1",
  poster: "hannah", postedAt: "2026-07-02T15:04:05Z", caption: "",
};

const extraction = {
  v: 1, vendor: "Tractor Supply", date: "2026-07-02", total: 84.12,
  payment_method: "card", line_items: [], suggested_category: "Repairs & Maintenance",
  confidence: 0.95, flags: [],
};

function makeDeps(description: string | null = `intro\n${renderMetaBlock(meta)}`) {
  const calls = {
    comments: [] as string[], statuses: [] as string[],
    replies: [] as string[], reacts: [] as string[], sidecars: [] as Array<{ key: string; value: unknown }>,
  };
  const deps = {
    issues: {
      getDescription: async () => description,
      createComment: async (_id: string, body: string) => void calls.comments.push(body),
      setStatus: async (_id: string, s: string) => void calls.statuses.push(s),
    },
    discord: {
      replyToMessage: async (_c: string, _m: string, content: string) => {
        calls.replies.push(content);
        return { ok: true as const, data: {} };
      },
      react: async (_c: string, _m: string, emoji: string) => {
        calls.reacts.push(emoji);
        return { ok: true as const, data: undefined };
      },
    },
    archive: { putJson: async (key: string, value: unknown) => void calls.sidecars.push({ key, value }) },
    log: () => undefined,
  };
  return { deps, calls };
}

describe("receipt_record_extraction", () => {
  it("writes sidecar, comments, replies in thread, sets in_review", async () => {
    const { deps, calls } = makeDeps();
    const out = await handleRecordExtraction(deps, { issueId: "i1", extraction });
    expect(out.error).toBeUndefined();
    expect(calls.sidecars[0]).toMatchObject({ key: "receipts/2026/07/x.jpg.json" });
    expect(calls.comments[0]).toContain("receipt-extraction v1");
    expect(calls.replies[0]).toContain("Tractor Supply");
    expect(calls.statuses).toEqual(["in_review"]);
  });

  it("rejects malformed extraction without side effects", async () => {
    const { deps, calls } = makeDeps();
    const out = await handleRecordExtraction(deps, { issueId: "i1", extraction: { vendor: 42 } });
    expect(typeof out.error).toBe("string");
    expect(calls.statuses).toHaveLength(0);
    expect(calls.sidecars).toHaveLength(0);
  });

  it("errors when issue has no receipt-meta block", async () => {
    const { deps } = makeDeps("plain description");
    const out = await handleRecordExtraction(deps, { issueId: "i1", extraction });
    expect(out.error).toContain("receipt-meta");
  });
});

describe("receipt_request_retake", () => {
  it("replies with reason and blocks the issue", async () => {
    const { deps, calls } = makeDeps();
    await handleRequestRetake(deps, { issueId: "i1", reason: "total is cut off" });
    expect(calls.replies[0]).toContain("total is cut off");
    expect(calls.statuses).toEqual(["blocked"]);
  });
});

describe("receipt_dismiss", () => {
  it("reacts 🤷 and cancels", async () => {
    const { deps, calls } = makeDeps();
    await handleDismiss(deps, { issueId: "i1", reason: "not a receipt" });
    expect(calls.reacts).toEqual(["🤷"]);
    expect(calls.statuses).toEqual(["cancelled"]);
  });
});

describe("discord_reply", () => {
  it("posts a free-form thread reply", async () => {
    const { deps, calls } = makeDeps();
    await handleReply(deps, { issueId: "i1", message: "which card was this on?" });
    expect(calls.replies).toEqual(["which card was this on?"]);
  });
});
