import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("/api/vault/inbox/[...path]", () => {
  it("returns 503 when VAULT_SERVER_URL is not set", async () => {
    vi.stubEnv("VAULT_SERVER_URL", "");
    const req = new Request("http://localhost/api/vault/inbox/note.md");
    const res = await GET(req, { params: Promise.resolve({ path: ["note.md"] }) });
    expect(res.status).toBe(503);
  });

  it("proxies GET to vault-server /inbox/<path> and returns the note", async () => {
    vi.stubEnv("VAULT_SERVER_URL", "http://vault-server:7777");
    const note = { path: "note.md", title: "Note", capturedAt: "2026-06-01T00:00:00Z", body: "body" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(note), { status: 200 })),
    );
    const req = new Request("http://localhost/api/vault/inbox/note.md");
    const res = await GET(req, { params: Promise.resolve({ path: ["note.md"] }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe("Note");
  });

  it("joins catch-all segments for nested paths", async () => {
    vi.stubEnv("VAULT_SERVER_URL", "http://vault-server:7777");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ path: "sub/note.md", title: "Sub", capturedAt: "2026-06-01T00:00:00Z", body: "b" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const req = new Request("http://localhost/api/vault/inbox/sub/note.md");
    await GET(req, { params: Promise.resolve({ path: ["sub", "note.md"] }) });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("sub"),
      expect.any(Object),
    );
  });

  it("returns 404 when vault-server returns 404", async () => {
    vi.stubEnv("VAULT_SERVER_URL", "http://vault-server:7777");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 404 })),
    );
    const req = new Request("http://localhost/api/vault/inbox/missing.md");
    const res = await GET(req, { params: Promise.resolve({ path: ["missing.md"] }) });
    expect(res.status).toBe(404);
  });

  it("returns 502 when fetch throws", async () => {
    vi.stubEnv("VAULT_SERVER_URL", "http://vault-server:7777");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const req = new Request("http://localhost/api/vault/inbox/note.md");
    const res = await GET(req, { params: Promise.resolve({ path: ["note.md"] }) });
    expect(res.status).toBe(502);
  });
});
