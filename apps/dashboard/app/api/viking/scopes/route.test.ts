import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("/api/viking/scopes", () => {
  it("returns honest zeros when OPENVIKING_URL is unset", async () => {
    vi.stubEnv("OPENVIKING_URL", "");
    const res = await GET();
    expect(await res.json()).toEqual({ reachable: false, total: 0, scopes: {} });
  });

  it("returns honest zeros when Viking has no data", async () => {
    vi.stubEnv("OPENVIKING_URL", "http://viking:1933");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ counts: {} }), { status: 200 })),
    );

    const res = await GET();
    expect(await res.json()).toEqual({ reachable: true, total: 0, scopes: {} });
  });

  it("aggregates per-scope counts into total", async () => {
    vi.stubEnv("OPENVIKING_URL", "http://viking:1933");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ counts: { resources: 5, "user/memories": 2 } }),
          { status: 200 },
        ),
      ),
    );

    const res = await GET();
    expect(await res.json()).toEqual({
      reachable: true,
      total: 7,
      scopes: { resources: 5, "user/memories": 2 },
    });
  });

  it("returns reachable:false when Viking is unreachable", async () => {
    vi.stubEnv("OPENVIKING_URL", "http://viking:1933");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reachable: false, total: 0, scopes: {} });
  });
});
