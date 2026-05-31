import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RemoteVaultClient } from "./remote-client";

const BASE_URL = "http://vault.test:7779";

/** Build a fake fetch Response with the given JSON body. */
function fakeResponse(
  data: unknown,
  init?: { ok?: boolean; status?: number }
): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => data,
  } as unknown as Response;
}

describe("RemoteVaultClient", () => {
  const originalFetch = globalThis.fetch;
  let client: RemoteVaultClient;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
    client = new RemoteVaultClient({ baseUrl: BASE_URL });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("list() maps {tree, flatPaths} -> {tree, flat}", async () => {
    const tree = { path: "/", name: "wiki", kind: "folder", children: [] };
    vi.mocked(globalThis.fetch).mockResolvedValue(
      fakeResponse({ tree, flatPaths: ["a", "b"] })
    );

    const result = await client.list();

    expect(result).toEqual({ tree, flat: ["a", "b"] });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${BASE_URL}/tree`,
      expect.objectContaining({ cache: "no-store" })
    );
  });

  it("read() returns null on 404", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      fakeResponse({ error: "not found" }, { ok: false, status: 404 })
    );

    const result = await client.read("Missing");

    expect(result).toBeNull();
  });

  it("read() returns the page on 200", async () => {
    const page = { path: "Foo", title: "Foo", tags: [], body: "hi" };
    vi.mocked(globalThis.fetch).mockResolvedValue(fakeResponse(page));

    const result = await client.read("Foo");

    expect(result).toEqual(page);
  });

  it("search() returns the results array from {results, total}", async () => {
    const results = [{ path: "A" }, { path: "B" }];
    vi.mocked(globalThis.fetch).mockResolvedValue(
      fakeResponse({ results, total: 2 })
    );

    const out = await client.search("query", { tags: ["farm"], limit: 10 });

    expect(out).toEqual(results);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]![0] as string;
    expect(calledUrl).toContain("q=query");
    expect(calledUrl).toContain("tags=farm");
    expect(calledUrl).toContain("limit=10");
  });

  it("getBacklinks() returns the backlinks array", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      fakeResponse({ backlinks: ["X", "Y"] })
    );

    const out = await client.getBacklinks("Foo");

    expect(out).toEqual(["X", "Y"]);
  });

  it("stats() returns the VaultStats object", async () => {
    const stats = { pageCount: 5, builtAt: 123, ttlExpiresAt: 456 };
    vi.mocked(globalThis.fetch).mockResolvedValue(fakeResponse(stats));

    const out = await client.stats();

    expect(out).toEqual(stats);
  });

  it("listInbox() fills the missing body field with \"\"", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      fakeResponse({
        items: [{ path: "n1.md", title: "Note 1", capturedAt: "2026-01-01" }],
      })
    );

    const out = await client.listInbox();

    expect(out).toEqual([
      { path: "n1.md", title: "Note 1", capturedAt: "2026-01-01", body: "" },
    ]);
  });

  it("promoteInbox() throws with the deferred-to-Phase-E message", async () => {
    await expect(client.promoteInbox()).rejects.toThrow(
      /deferred to Phase E/
    );
  });
});
