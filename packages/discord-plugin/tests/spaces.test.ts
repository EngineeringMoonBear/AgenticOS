import { describe, it, expect } from "vitest";
import { ReceiptArchive, receiptKeyFor } from "../src/spaces.js";

describe("ReceiptArchive", () => {
  it("builds date-partitioned keys with message and attachment ids", () => {
    expect(
      receiptKeyFor("2026-07-02T15:04:05Z", "111", "222", "IMG 001.jpg"),
    ).toBe("receipts/2026/07/2026-07-02_111_222_IMG_001.jpg");
  });

  it("put sends a PutObjectCommand with bucket, key, body, content type", async () => {
    const sent: unknown[] = [];
    const archive = new ReceiptArchive({ send: async (c) => void sent.push(c) }, "bkt");
    await archive.put("k", new Uint8Array([1]), "image/jpeg");
    const input = (sent[0] as { input: Record<string, unknown> }).input;
    expect(input).toMatchObject({ Bucket: "bkt", Key: "k", ContentType: "image/jpeg" });
  });
});
