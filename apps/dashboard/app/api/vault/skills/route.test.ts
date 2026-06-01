import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("/api/vault/skills", () => {
  it("returns empty when VAULT_SERVER_URL is unset", async () => {
    vi.stubEnv("VAULT_SERVER_URL", "");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ totalRegistered: 0, skills: [] });
  });

  it("proxies to vault-server when configured", async () => {
    vi.stubEnv("VAULT_SERVER_URL", "http://vault-server:7777");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            totalRegistered: 1,
            skills: [
              {
                name: "triage",
                description: "x",
                triggers: [],
                usedBy: [],
                path: "wiki/Skills/triage.md",
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
    expect(body.totalRegistered).toBe(1);
    expect(body.skills[0].name).toBe("triage");
  });

  it("returns 502 when vault-server errors", async () => {
    vi.stubEnv("VAULT_SERVER_URL", "http://vault-server:7777");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));
    const res = await GET();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("HTTP 500");
  });

  it("returns 502 when fetch throws", async () => {
    vi.stubEnv("VAULT_SERVER_URL", "http://vault-server:7777");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const res = await GET();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("ECONNREFUSED");
  });
});
