import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("/api/vault/recent-changes", () => {
  it("returns available:false when VAULT_SERVER_URL is unset", async () => {
    vi.stubEnv("VAULT_SERVER_URL", "");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      source: "syncthing",
      available: false,
      changes: [],
    });
  });

  it("proxies the vault-server shape when configured", async () => {
    vi.stubEnv("VAULT_SERVER_URL", "http://vault-server:7777");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            available: true,
            changes: [
              {
                path: "farming/rotation.md",
                kind: "updated",
                occurredAt: "2026-06-01T13:45:00Z",
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("syncthing");
    expect(body.available).toBe(true);
    expect(body.changes).toEqual([
      {
        path: "farming/rotation.md",
        kind: "updated",
        occurredAt: "2026-06-01T13:45:00Z",
      },
    ]);
  });

  it("returns 502 with available:false when vault-server errors", async () => {
    vi.stubEnv("VAULT_SERVER_URL", "http://vault-server:7777");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));

    const res = await GET();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.available).toBe(false);
    expect(body.changes).toEqual([]);
    expect(body.error).toBe("HTTP 503");
  });

  it("returns 502 with available:false when fetch throws", async () => {
    vi.stubEnv("VAULT_SERVER_URL", "http://vault-server:7777");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const res = await GET();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.available).toBe(false);
    expect(body.error).toBe("ECONNREFUSED");
  });
});
