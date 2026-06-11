import { describe, it, expect, vi, afterEach } from "vitest";
import { VaultWriter } from "../src/vault-writer.js";

afterEach(() => vi.restoreAllMocks());

describe("VaultWriter.writePage", () => {
  it("PUTs path + content to vault-server", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ path: "wiki/_meta/dev-pr-digest.md" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const writer = new VaultWriter({ baseUrl: "http://vault-server:7777", timeoutMs: 5000 });
    const result = await writer.writePage("wiki/_meta/dev-pr-digest.md", "# hi\n");

    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://vault-server:7777/page");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({
      path: "wiki/_meta/dev-pr-digest.md",
      content: "# hi\n",
    });
  });

  it("returns an error Result on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "nope" }) }));
    const writer = new VaultWriter({ baseUrl: "http://vault-server:7777", timeoutMs: 5000 });
    const result = await writer.writePage("wiki/_meta/x.md", "y");
    expect(result.ok).toBe(false);
  });
});
