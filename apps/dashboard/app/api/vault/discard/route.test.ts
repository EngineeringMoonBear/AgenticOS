import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("/api/vault/discard", () => {
  it("returns 503 when VAULT_SERVER_URL is not set", async () => {
    vi.stubEnv("VAULT_SERVER_URL", "");
    const req = new Request("http://localhost/api/vault/discard", {
      method: "POST",
      body: JSON.stringify({ inboxPath: "note.md" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(503);
  });

  it("returns 400 when inboxPath is missing", async () => {
    vi.stubEnv("VAULT_SERVER_URL", "http://vault-server:7777");
    const req = new Request("http://localhost/api/vault/discard", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("proxies POST to vault-server /discard and returns archivedPath", async () => {
    vi.stubEnv("VAULT_SERVER_URL", "http://vault-server:7777");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ archivedPath: "inbox/archived/note.md" }), { status: 200 }),
      ),
    );
    const req = new Request("http://localhost/api/vault/discard", {
      method: "POST",
      body: JSON.stringify({ inboxPath: "note.md" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.archivedPath).toContain("archived");
  });

  it("propagates non-OK status from vault-server", async () => {
    vi.stubEnv("VAULT_SERVER_URL", "http://vault-server:7777");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "not found" }), { status: 404 })),
    );
    const req = new Request("http://localhost/api/vault/discard", {
      method: "POST",
      body: JSON.stringify({ inboxPath: "missing.md" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("returns 502 when fetch throws", async () => {
    vi.stubEnv("VAULT_SERVER_URL", "http://vault-server:7777");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const req = new Request("http://localhost/api/vault/discard", {
      method: "POST",
      body: JSON.stringify({ inboxPath: "note.md" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(502);
  });
});
