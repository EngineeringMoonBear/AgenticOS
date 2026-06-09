import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VaultClient } from "../src/vault-client.js";

describe("VaultClient", () => {
  let client: VaultClient;
  const baseUrl = "http://vault-server:7777";

  beforeEach(() => {
    client = new VaultClient({ baseUrl, timeoutMs: 5000 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("search", () => {
    it("returns results on success", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [{ path: "wiki/Farming/notes.md", title: "Notes", snippet: "some text", score: 0.9 }],
            total: 1,
          }),
          { status: 200 },
        ),
      );

      const result = await client.search("farming");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.results).toHaveLength(1);
        expect(result.data.results[0].path).toBe("wiki/Farming/notes.md");
      }
      expect(fetch).toHaveBeenCalledWith(
        `${baseUrl}/search?q=farming`,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it("passes limit param", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [], total: 0 }), { status: 200 }),
      );

      await client.search("test", { limit: 5 });

      expect(fetch).toHaveBeenCalledWith(
        `${baseUrl}/search?q=test&limit=5`,
        expect.any(Object),
      );
    });

    it("returns error when vault-server is unreachable", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
        new Error("fetch failed"),
      );

      const result = await client.search("test");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("fetch failed");
      }
    });
  });

  describe("getPage", () => {
    it("returns page content on success", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            path: "wiki/Software/AgenticOS.md",
            title: "AgenticOS",
            content: "# AgenticOS",
            frontmatter: { tags: ["software"] },
          }),
          { status: 200 },
        ),
      );

      const result = await client.getPage("wiki/Software/AgenticOS.md");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.title).toBe("AgenticOS");
      }
      expect(fetch).toHaveBeenCalledWith(
        `${baseUrl}/page?path=wiki%2FSoftware%2FAgenticOS.md`,
        expect.any(Object),
      );
    });

    it("returns error on 404", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Page not found" }), { status: 404 }),
      );

      const result = await client.getPage("wiki/missing.md");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Page not found");
      }
    });
  });

  describe("listPages", () => {
    it("returns tree and flat paths", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            tree: { name: "wiki", children: [] },
            flatPaths: ["wiki/HELLO.md"],
          }),
          { status: 200 },
        ),
      );

      const result = await client.listPages();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.flatPaths).toContain("wiki/HELLO.md");
      }
    });
  });

  describe("getStats", () => {
    it("returns stats", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({ pageCount: 42, categories: ["Software", "Farming"] }),
          { status: 200 },
        ),
      );

      const result = await client.getStats();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.pageCount).toBe(42);
      }
    });
  });

  describe("getInbox", () => {
    it("returns inbox items", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [{ path: "quick-capture.md", title: "Quick Capture", capturedAt: "2026-06-09" }],
          }),
          { status: 200 },
        ),
      );

      const result = await client.getInbox();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.items).toHaveLength(1);
      }
    });
  });

  describe("discardInboxItem", () => {
    it("returns archived path on success", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({ archivedPath: "inbox/archived/quick-capture.md" }),
          { status: 200 },
        ),
      );

      const result = await client.discardInboxItem("quick-capture.md");

      expect(result.ok).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        `${baseUrl}/discard`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "Content-Type": "application/json" }),
          body: JSON.stringify({ inboxPath: "quick-capture.md" }),
        }),
      );
    });

    it("rejects paths outside inbox client-side", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const result = await client.discardInboxItem("../wiki/secret.md");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("traversal");
      }
      // fetch should NOT have been called
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
