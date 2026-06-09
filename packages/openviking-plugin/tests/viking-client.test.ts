import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VikingClient } from "../src/viking-client.js";

describe("VikingClient", () => {
  let client: VikingClient;
  const baseUrl = "http://openviking:1933";
  const apiKey = "test-api-key";

  beforeEach(() => {
    client = new VikingClient({
      baseUrl,
      apiKey,
      account: "agenticos",
      user: "deploy",
      readTimeoutMs: 5000,
      writeTimeoutMs: 10000,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("remember", () => {
    it("stores a memory and returns id", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "mem-001", path: "viking://agenticos/deploy/memories/mem-001", created: "2026-06-09" }),
          { status: 200 },
        ),
      );

      const result = await client.remember("The barn roof needs repair", { category: "farm-ops" });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.id).toBe("mem-001");
      }
      expect(fetch).toHaveBeenCalledWith(
        `${baseUrl}/api/v1/memories`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          }),
        }),
      );
    });

    it("returns error when OpenViking is unreachable", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("connection refused"));

      const result = await client.remember("test", {});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("connection refused");
      }
    });
  });

  describe("recall", () => {
    it("returns ranked memories", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            memories: [
              { id: "mem-001", text: "Barn roof repair", score: 0.92, category: "farm-ops", created: "2026-06-09" },
            ],
          }),
          { status: 200 },
        ),
      );

      const result = await client.recall("roof repair", { limit: 5 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.memories).toHaveLength(1);
        expect(result.data.memories[0].score).toBe(0.92);
      }
    });
  });

  describe("find", () => {
    it("returns memories at a path", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            memories: [{ id: "mem-001", text: "something", path: "viking://agenticos/deploy/farm-ops", category: "farm-ops" }],
          }),
          { status: 200 },
        ),
      );

      const result = await client.find("farm-ops");

      expect(result.ok).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/memories?path=farm-ops"),
        expect.any(Object),
      );
    });
  });

  describe("abstract", () => {
    it("returns a summary", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({ abstractId: "abs-001", summary: "Farm needs roof work", sourceCount: 3 }),
          { status: 200 },
        ),
      );

      const result = await client.abstract(["mem-001", "mem-002", "mem-003"]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.sourceCount).toBe(3);
      }
    });
  });

  describe("stats", () => {
    it("returns memory statistics", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({ total: 1204, byCategory: { "farm-ops": 300, dev: 500, general: 404 } }),
          { status: 200 },
        ),
      );

      const result = await client.stats();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.total).toBe(1204);
      }
    });
  });
});
