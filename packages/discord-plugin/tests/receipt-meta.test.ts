import { describe, it, expect } from "vitest";
import {
  renderMetaBlock, parseMetaBlock,
  renderExtractionComment, parseExtractionComment,
} from "../src/receipt-meta.js";
import type { ReceiptMeta, ReceiptExtraction } from "../src/types.js";

const meta: ReceiptMeta = {
  v: 1, spacesKey: "receipts/2026/07/x.jpg", discordChannelId: "c1",
  discordMessageId: "m1", discordAttachmentId: "a1",
  poster: "josh", postedAt: "2026-07-02T15:04:05Z", caption: "cash",
};

const extraction: ReceiptExtraction = {
  v: 1, vendor: "Tractor Supply", date: "2026-07-02", total: 84.12,
  payment_method: "card",
  line_items: [{ description: "fence wire", amount: 84.12 }],
  suggested_category: "Repairs & Maintenance", confidence: 0.95, flags: [],
};

describe("receipt-meta round trips", () => {
  it("meta block round-trips through issue description text", () => {
    const desc = `Receipt from josh.\n\n${renderMetaBlock(meta)}\n\nMore prose.`;
    expect(parseMetaBlock(desc)).toEqual(meta);
  });
  it("returns null when marker absent", () => {
    expect(parseMetaBlock("no marker here")).toBeNull();
  });
  it("extraction comment round-trips", () => {
    const comment = renderExtractionComment(extraction);
    expect(comment).toContain("Tractor Supply");           // human-readable part
    expect(parseExtractionComment(comment)).toEqual(extraction);
  });
  it("extraction parse tolerates surrounding prose", () => {
    const body = `Here you go.\n${renderExtractionComment(extraction)}\nthanks`;
    expect(parseExtractionComment(body)).toEqual(extraction);
  });
});
