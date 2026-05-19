import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { HermesClient } from "../src/client";
import { HermesOfflineError, HermesRunNotFoundError } from "../src/errors";

const BASE_URL = "http://127.0.0.1:7600";
const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(handler: (req: Request) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(typeof input === "string" || input instanceof URL ? input.toString() : input.url, init);
    return handler(req);
  }) as typeof fetch;
}

beforeEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("HermesClient.getHealth", () => {
  it("returns parsed health on 200", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ status: "ok", version: "0.1.0", uptimeMs: 1000, activeRuns: 2 }), { status: 200 }),
    );
    const client = new HermesClient({ baseUrl: BASE_URL });
    const health = await client.getHealth();
    expect(health.status).toBe("ok");
    expect(health.activeRuns).toBe(2);
  });

  it("throws HermesOfflineError on network failure", async () => {
    mockFetch(async () => { throw new TypeError("fetch failed"); });
    const client = new HermesClient({ baseUrl: BASE_URL });
    await expect(client.getHealth()).rejects.toBeInstanceOf(HermesOfflineError);
  });
});

describe("HermesClient.getRun", () => {
  it("returns the run on 200", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({
        id: "run_1", skillId: "curator", status: "running",
        model: "claude-sonnet-4-6", startedAt: "2026-01-01T00:00:00Z",
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, tags: [],
      }), { status: 200 }),
    );
    const client = new HermesClient({ baseUrl: BASE_URL });
    const run = await client.getRun("run_1");
    expect(run?.id).toBe("run_1");
  });

  it("returns null on 404", async () => {
    mockFetch(async () => new Response("not found", { status: 404 }));
    const client = new HermesClient({ baseUrl: BASE_URL });
    expect(await client.getRun("missing")).toBeNull();
  });
});

describe("HermesClient.cancelRun", () => {
  it("throws HermesRunNotFoundError on 404", async () => {
    mockFetch(async () => new Response("not found", { status: 404 }));
    const client = new HermesClient({ baseUrl: BASE_URL });
    await expect(client.cancelRun("missing")).rejects.toBeInstanceOf(HermesRunNotFoundError);
  });

  it("succeeds on 200", async () => {
    mockFetch(async () => new Response("", { status: 200 }));
    const client = new HermesClient({ baseUrl: BASE_URL });
    await expect(client.cancelRun("run_1", "user")).resolves.toBeUndefined();
  });
});

describe("HermesClient.dispatchRun", () => {
  it("sends POST with skillId and prompts", async () => {
    let captured: Request | null = null;
    mockFetch(async (req) => {
      captured = req;
      return new Response(JSON.stringify({
        id: "run_new", skillId: "curator", status: "queued",
        model: "claude-sonnet-4-6", startedAt: "2026-01-01T00:00:00Z",
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, tags: [],
      }), { status: 200 });
    });
    const client = new HermesClient({ baseUrl: BASE_URL });
    const run = await client.dispatchRun({
      skillId: "curator",
      systemPrompt: "you are X",
      userPrompt: "do Y",
    });
    expect(run.id).toBe("run_new");
    expect(captured!.method).toBe("POST");
  });
});
