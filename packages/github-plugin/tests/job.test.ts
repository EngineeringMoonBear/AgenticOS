import { describe, it, expect, vi } from "vitest";
import { runPrTriage } from "../src/job.js";

function fakeClient(overrides: Record<string, any> = {}) {
  return {
    searchOpenPrs: vi.fn().mockResolvedValue({
      ok: true,
      data: [
        {
          repoFullName: "o/r", number: 7, title: "T", author: "a",
          draft: false, updatedAt: "2026-06-09T00:00:00Z", htmlUrl: "u",
        },
      ],
    }),
    prDetail: vi.fn().mockResolvedValue({ ok: true, data: { mergeableState: "clean", headSha: "abc" } }),
    prChecksState: vi.fn().mockResolvedValue({ ok: true, data: "success" }),
    prReviewState: vi.fn().mockResolvedValue({ ok: true, data: "approved" }),
    ...overrides,
  };
}

describe("runPrTriage", () => {
  it("fetches, classifies, renders, and writes the digest", async () => {
    const writer = { writePage: vi.fn().mockResolvedValue({ ok: true, data: { path: "p" } }) };
    const summary = await runPrTriage({
      client: fakeClient() as any,
      writer: writer as any,
      now: new Date("2026-06-10T00:00:00Z"),
      staleDays: 7,
      vaultPath: "wiki/_meta/dev-pr-digest.md",
    });

    expect(summary.total).toBe(1);
    expect(summary.errored).toBe(0);
    expect(summary.buckets["ready-to-merge"]).toBe(1);
    expect(writer.writePage).toHaveBeenCalledOnce();
    const [, content] = writer.writePage.mock.calls[0];
    expect(content).toContain("ready-to-merge");
  });

  it("isolates a per-PR error without aborting the run", async () => {
    const client = fakeClient({
      prDetail: vi.fn().mockResolvedValue({ ok: false, error: "boom" }),
    });
    const writer = { writePage: vi.fn().mockResolvedValue({ ok: true, data: { path: "p" } }) };
    const summary = await runPrTriage({
      client: client as any, writer: writer as any,
      now: new Date("2026-06-10T00:00:00Z"), staleDays: 7,
      vaultPath: "wiki/_meta/dev-pr-digest.md",
    });
    expect(summary.errored).toBe(1);
    expect(writer.writePage).toHaveBeenCalledOnce(); // still writes the digest
  });
});
