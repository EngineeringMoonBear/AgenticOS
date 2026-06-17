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

  describe("addResource", () => {
    it("does the two-step temp_upload then resources create", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ status: "ok", result: { temp_file_id: "upload_abc.md" } }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));

      const result = await client.addResource(
        "# Hello",
        "HELLO.md",
        "viking://resources/notes/HELLO.md",
      );

      expect(result.ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      // Step 1: multipart temp_upload
      const [uploadUrl, uploadInit] = fetchSpy.mock.calls[0];
      expect(uploadUrl).toBe(`${baseUrl}/api/v1/resources/temp_upload`);
      expect((uploadInit as RequestInit).method).toBe("POST");
      expect((uploadInit as RequestInit).body).toBeInstanceOf(FormData);
      expect((uploadInit as RequestInit).headers).toEqual(
        expect.objectContaining({
          Authorization: `Bearer ${apiKey}`,
          "X-OpenViking-Account": "agenticos",
          "X-OpenViking-User": "deploy",
        }),
      );

      // Step 2: JSON resources create with the temp_file_id + target uri
      const [createUrl, createInit] = fetchSpy.mock.calls[1];
      expect(createUrl).toBe(`${baseUrl}/api/v1/resources`);
      expect((createInit as RequestInit).method).toBe("POST");
      expect(JSON.parse((createInit as RequestInit).body as string)).toEqual({
        temp_file_id: "upload_abc.md",
        to: "viking://resources/notes/HELLO.md",
        create_parent: true,
      });
    });

    it("returns error when temp_upload yields no temp_file_id", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "ok", result: {} }), { status: 200 }),
      );

      const result = await client.addResource("x", "a.md", "viking://resources/notes/a.md");

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("temp_file_id");
    });

    it("surfaces an error from the create step", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ result: { temp_file_id: "t1" } }), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: "bad target" }), { status: 400 }),
        );

      const result = await client.addResource("x", "a.md", "viking://resources/notes/a.md");

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("bad target");
    });
  });

  describe("rm", () => {
    it("DELETEs the fs endpoint with recursive=true", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));

      const result = await client.rm("viking://resources/notes/HELLO.md");

      expect(result.ok).toBe(true);
      const [url, init] = fetchSpy.mock.calls[0];
      expect((init as RequestInit).method).toBe("DELETE");
      const u = String(url);
      expect(u).toContain(`${baseUrl}/api/v1/fs?`);
      expect(u).toContain("recursive=true");
      expect(u).toContain("uri=viking");
    });

    it("treats a 404 as success (resource already gone)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 404 }));

      const result = await client.rm("viking://resources/notes/gone.md");

      expect(result.ok).toBe(true);
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
