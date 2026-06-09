import { describe, it, expect, vi } from "vitest";
import { handleSearch } from "../src/tools/search.js";
import { handleRead } from "../src/tools/read.js";
import { handleList } from "../src/tools/list.js";
import { handleStats } from "../src/tools/stats.js";
import { handleDiscard } from "../src/actions/discard.js";
import type { VaultClient } from "../src/vault-client.js";

function mockClient(overrides: Partial<VaultClient> = {}): VaultClient {
  return {
    search: vi.fn().mockResolvedValue({ ok: true, data: { results: [], total: 0 } }),
    getPage: vi.fn().mockResolvedValue({ ok: true, data: { path: "wiki/test.md", title: "Test", content: "# Test", frontmatter: {} } }),
    listPages: vi.fn().mockResolvedValue({ ok: true, data: { tree: { name: "wiki", children: [] }, flatPaths: [] } }),
    getStats: vi.fn().mockResolvedValue({ ok: true, data: { pageCount: 0, categories: [] } }),
    getInbox: vi.fn().mockResolvedValue({ ok: true, data: { items: [] } }),
    discardInboxItem: vi.fn().mockResolvedValue({ ok: true, data: { archivedPath: "inbox/archived/test.md" } }),
    ...overrides,
  } as unknown as VaultClient;
}

describe("vault tool handlers", () => {
  describe("handleSearch", () => {
    it("calls client.search and returns results", async () => {
      const client = mockClient({
        search: vi.fn().mockResolvedValue({
          ok: true,
          data: { results: [{ path: "wiki/a.md", title: "A", snippet: "text", score: 0.9 }], total: 1 },
        }),
      });

      const result = await handleSearch(client, { query: "farming", limit: 5 });

      expect(client.search).toHaveBeenCalledWith("farming", { limit: 5 });
      expect(result).toEqual({
        results: [{ path: "wiki/a.md", title: "A", snippet: "text", score: 0.9 }],
        total: 1,
      });
    });

    it("returns error string when client fails", async () => {
      const client = mockClient({
        search: vi.fn().mockResolvedValue({ ok: false, error: "unreachable" }),
      });

      const result = await handleSearch(client, { query: "test" });

      expect(result).toEqual({ error: "unreachable" });
    });
  });

  describe("handleRead", () => {
    it("calls client.getPage and returns page data", async () => {
      const client = mockClient();
      const result = await handleRead(client, { path: "wiki/test.md" });

      expect(client.getPage).toHaveBeenCalledWith("wiki/test.md");
      expect(result).toHaveProperty("title", "Test");
    });
  });

  describe("handleList", () => {
    it("calls client.listPages and returns flat paths", async () => {
      const client = mockClient({
        listPages: vi.fn().mockResolvedValue({
          ok: true,
          data: { tree: { name: "wiki", children: [] }, flatPaths: ["wiki/a.md", "wiki/b.md"] },
        }),
      });

      const result = await handleList(client);

      expect(result).toEqual({ paths: ["wiki/a.md", "wiki/b.md"] });
    });
  });

  describe("handleStats", () => {
    it("returns stats from client", async () => {
      const client = mockClient({
        getStats: vi.fn().mockResolvedValue({
          ok: true,
          data: { pageCount: 42, categories: ["Software"] },
        }),
      });

      const result = await handleStats(client);

      expect(result).toEqual({ pageCount: 42, categories: ["Software"] });
    });
  });

  describe("handleDiscard", () => {
    it("calls client.discardInboxItem", async () => {
      const client = mockClient();
      const result = await handleDiscard(client, { path: "quick-capture.md" });

      expect(client.discardInboxItem).toHaveBeenCalledWith("quick-capture.md");
      expect(result).toEqual({ archivedPath: "inbox/archived/test.md" });
    });

    it("returns error when discard fails", async () => {
      const client = mockClient({
        discardInboxItem: vi.fn().mockResolvedValue({ ok: false, error: "not found" }),
      });

      const result = await handleDiscard(client, { path: "missing.md" });

      expect(result).toEqual({ error: "not found" });
    });
  });
});
