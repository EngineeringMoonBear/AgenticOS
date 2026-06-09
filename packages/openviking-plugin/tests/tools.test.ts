import { describe, it, expect, vi } from "vitest";
import { handleRemember } from "../src/tools/remember.js";
import { handleRecall } from "../src/tools/recall.js";
import { handleFind } from "../src/tools/find.js";
import { handleAbstract } from "../src/tools/abstract.js";
import { handleMemoryStats } from "../src/data/memory-stats.js";
import type { VikingClient } from "../src/viking-client.js";

function mockClient(overrides: Partial<VikingClient> = {}): VikingClient {
  return {
    remember: vi.fn().mockResolvedValue({ ok: true, data: { id: "mem-001", path: "viking://test", created: "2026-06-09" } }),
    recall: vi.fn().mockResolvedValue({ ok: true, data: { memories: [] } }),
    find: vi.fn().mockResolvedValue({ ok: true, data: { memories: [] } }),
    abstract: vi.fn().mockResolvedValue({ ok: true, data: { abstractId: "abs-001", summary: "sum", sourceCount: 2 } }),
    stats: vi.fn().mockResolvedValue({ ok: true, data: { total: 100, byCategory: { dev: 50, ops: 50 } } }),
    ...overrides,
  } as unknown as VikingClient;
}

describe("openviking tool handlers", () => {
  describe("handleRemember", () => {
    it("stores memory and returns id", async () => {
      const client = mockClient();
      const result = await handleRemember(client, { text: "Barn needs repair", category: "farm-ops" });

      expect(client.remember).toHaveBeenCalledWith("Barn needs repair", { category: "farm-ops" });
      expect(result).toEqual({ id: "mem-001", path: "viking://test", created: "2026-06-09" });
    });

    it("returns error on failure", async () => {
      const client = mockClient({
        remember: vi.fn().mockResolvedValue({ ok: false, error: "connection refused" }),
      });

      const result = await handleRemember(client, { text: "test" });
      expect(result).toEqual({ error: "connection refused" });
    });
  });

  describe("handleRecall", () => {
    it("returns ranked memories", async () => {
      const client = mockClient({
        recall: vi.fn().mockResolvedValue({
          ok: true,
          data: { memories: [{ id: "m1", text: "roof", score: 0.9, category: "farm-ops", created: "2026-06-09" }] },
        }),
      });

      const result = await handleRecall(client, { query: "roof", limit: 5 });

      expect(client.recall).toHaveBeenCalledWith("roof", { limit: 5 });
      expect(result).toHaveProperty("memories");
    });
  });

  describe("handleFind", () => {
    it("returns memories at path", async () => {
      const client = mockClient();
      const result = await handleFind(client, { path: "farm-ops" });

      expect(client.find).toHaveBeenCalledWith("farm-ops");
      expect(result).toHaveProperty("memories");
    });
  });

  describe("handleAbstract", () => {
    it("returns summary", async () => {
      const client = mockClient();
      const result = await handleAbstract(client, { memoryIds: ["m1", "m2"] });

      expect(client.abstract).toHaveBeenCalledWith(["m1", "m2"]);
      expect(result).toEqual({ abstractId: "abs-001", summary: "sum", sourceCount: 2 });
    });
  });

  describe("handleMemoryStats", () => {
    it("returns stats from client", async () => {
      const client = mockClient();
      const result = await handleMemoryStats(client);

      expect(result).toEqual({ total: 100, byCategory: { dev: 50, ops: 50 } });
    });
  });
});
