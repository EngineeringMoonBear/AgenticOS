import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("/api/viking/health", () => {
  it("returns reachable:false when OPENVIKING_URL is unset", async () => {
    vi.stubEnv("OPENVIKING_URL", "");
    const res = await GET();
    expect(await res.json()).toEqual({ reachable: false });
  });

  it("returns reachable:true with metrics on 200", async () => {
    vi.stubEnv("OPENVIKING_URL", "http://viking:1933");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ uptime_seconds: 1200, version: "0.3.19", memory_mb: 850 }),
          { status: 200 },
        ),
      ),
    );

    const res = await GET();
    expect(await res.json()).toEqual({
      reachable: true,
      uptimeSec: 1200,
      version: "0.3.19",
      ramMb: 850,
    });
  });

  it("returns reachable:false when Viking errors (unreachable)", async () => {
    vi.stubEnv("OPENVIKING_URL", "http://viking:1933");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reachable: false });
  });

  it("returns reachable:false on a non-200 response", async () => {
    vi.stubEnv("OPENVIKING_URL", "http://viking:1933");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));

    const res = await GET();
    expect(await res.json()).toEqual({ reachable: false });
  });
});
