import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetHermesClientForTests } from "@/lib/hermes/client-singleton";

vi.mock("server-only", () => ({}));

let fakeHermesUrl: string;
let fakeHermesHandler: (req: Request) => Response | Promise<Response>;
const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  fakeHermesUrl = "http://127.0.0.1:7600";
  globalThis.fetch = vi.fn(async (input, init) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    if (url.startsWith(fakeHermesUrl)) {
      const path = url.slice(fakeHermesUrl.length);
      const req = new Request(`http://test${path}`, init ?? {});
      return fakeHermesHandler(req);
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  vi.doMock("@/lib/config/config-io", () => ({
    readConfig: async () => ({
      hermesUrl:     fakeHermesUrl,
      vaultPath:     "/tmp/vault",
      projectRoots:  [],
      modelDefaults: { haiku: "x", sonnet: "y", opus: "z" },
      connectors:    [],
    }),
  }));
  __resetHermesClientForTests();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.resetModules();
  __resetHermesClientForTests();
});

describe("/api/hermes/health", () => {
  it("returns health when daemon is up", async () => {
    fakeHermesHandler = async () =>
      new Response(JSON.stringify({ status: "ok", version: "0.1.0", uptimeMs: 100, activeRuns: 0 }), { status: 200 });
    const { GET } = await import("@/app/api/hermes/health/route");
    const res = await GET();
    expect((await res.json()).status).toBe("ok");
  });

  it("returns offline when daemon is unreachable", async () => {
    fakeHermesHandler = async () => { throw new TypeError("fetch failed"); };
    const { GET } = await import("@/app/api/hermes/health/route");
    const res = await GET();
    expect((await res.json()).status).toBe("offline");
  });
});

describe("/api/hermes/runs", () => {
  it("POST validates body with Zod (400 on missing fields)", async () => {
    fakeHermesHandler = async () => new Response("", { status: 200 });
    const { POST } = await import("@/app/api/hermes/runs/route");
    const res = await POST(new Request("http://localhost/api/hermes/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skillId: "x" }),
    }));
    expect(res.status).toBe(400);
  });

  it("POST dispatches to Hermes on valid body", async () => {
    fakeHermesHandler = async (req) => {
      if (req.url.endsWith("/runs") && req.method === "POST") {
        return new Response(JSON.stringify({
          id: "run_1", skillId: "curator", status: "queued", model: "x",
          startedAt: "2026", inputTokens: 0, outputTokens: 0,
          cacheReadTokens: 0, cacheWriteTokens: 0, tags: [],
        }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    const { POST } = await import("@/app/api/hermes/runs/route");
    const res = await POST(new Request("http://localhost/api/hermes/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skillId: "curator", systemPrompt: "x", userPrompt: "y" }),
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("run_1");
  });
});
