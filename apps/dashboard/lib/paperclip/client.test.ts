import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We test the factory function + all six methods with a mocked global fetch.
// Each test asserts:
//   1. The correct URL path + query string is requested.
//   2. Authorization: Bearer <key> header is sent.
//   3. The parsed response is returned as {ok:true, data:...}.
//   4. Non-2xx responses are mapped to {ok:false, error:...}.

const BASE_URL = "https://paperclip.example.com";
const BOARD_KEY = "test-board-key";
const COMPANY_ID = "company-abc";

function makeCfg() {
  return { apiUrl: BASE_URL, boardKey: BOARD_KEY, companyId: COMPANY_ID };
}

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

// Dynamic import so missing module → clear failure (Step 2 in the brief)
async function getClient() {
  const mod = await import("./client");
  return mod.createPaperclipClient(makeCfg());
}

describe("PaperclipClient", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── costSummary ────────────────────────────────────────────────────────────

  describe("costSummary", () => {
    const payload = {
      companyId: COMPANY_ID,
      spendCents: 1234,
      budgetCents: 5000,
      utilizationPercent: 24.68,
    };

    it("calls the correct path with bearer auth and returns parsed data", async () => {
      globalThis.fetch = mockFetch(200, payload);
      const client = await getClient();

      const result = await client.costSummary({ from: "2024-01-01", to: "2024-01-31" });

      expect(result).toEqual({ ok: true, data: payload });

      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).toContain(`/api/companies/${COMPANY_ID}/costs/summary`);
      expect(url).toContain("from=2024-01-01");
      expect(url).toContain("to=2024-01-31");
      expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${BOARD_KEY}`);
    });

    it("returns {ok:false} on non-2xx", async () => {
      globalThis.fetch = mockFetch(403, { error: "Forbidden" });
      const client = await getClient();

      const result = await client.costSummary({ from: "2024-01-01", to: "2024-01-31" });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/403|Forbidden/i);
    });

    it("omits date params when not provided", async () => {
      globalThis.fetch = mockFetch(200, payload);
      const client = await getClient();
      await client.costSummary({});
      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).not.toContain("from=");
      expect(url).not.toContain("to=");
    });
  });

  // ── costByAgentModel ───────────────────────────────────────────────────────

  describe("costByAgentModel", () => {
    const payload = [
      { agentId: "a1", agentName: "Alice", provider: "anthropic", model: "claude-3", costCents: 500 },
    ];

    it("calls the correct path with bearer auth and returns parsed data", async () => {
      globalThis.fetch = mockFetch(200, payload);
      const client = await getClient();

      const result = await client.costByAgentModel({ from: "2024-01-01", to: "2024-01-31" });

      expect(result).toEqual({ ok: true, data: payload });

      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).toContain(`/api/companies/${COMPANY_ID}/costs/by-agent-model`);
      expect(url).toContain("from=2024-01-01");
      expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${BOARD_KEY}`);
    });

    it("returns {ok:false} on non-2xx", async () => {
      globalThis.fetch = mockFetch(500, { error: "Internal Server Error" });
      const client = await getClient();
      const result = await client.costByAgentModel({});
      expect(result.ok).toBe(false);
    });
  });

  // ── heartbeatRuns ──────────────────────────────────────────────────────────

  describe("heartbeatRuns", () => {
    const payload = [
      { id: "run-1", status: "done", agentId: "a1", createdAt: "2024-01-01T00:00:00Z" },
    ];

    it("calls the correct path with limit param and bearer auth", async () => {
      globalThis.fetch = mockFetch(200, payload);
      const client = await getClient();

      const result = await client.heartbeatRuns({ limit: 50 });

      expect(result).toEqual({ ok: true, data: payload });

      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).toContain(`/api/companies/${COMPANY_ID}/heartbeat-runs`);
      expect(url).toContain("limit=50");
      expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${BOARD_KEY}`);
    });

    it("includes status param when provided", async () => {
      globalThis.fetch = mockFetch(200, payload);
      const client = await getClient();
      await client.heartbeatRuns({ limit: 10, status: "running" });
      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).toContain("status=running");
    });

    it("returns {ok:false} on non-2xx", async () => {
      globalThis.fetch = mockFetch(401, { error: "Unauthorized" });
      const client = await getClient();
      const result = await client.heartbeatRuns({ limit: 10 });
      expect(result.ok).toBe(false);
    });
  });

  // ── activity ───────────────────────────────────────────────────────────────

  describe("activity", () => {
    const payload = [
      { id: "act-1", action: "issue.created", entityType: "issue", entityId: "i1", createdAt: "2024-01-01T00:00:00Z" },
    ];

    it("calls the correct path with limit param and bearer auth", async () => {
      globalThis.fetch = mockFetch(200, payload);
      const client = await getClient();

      const result = await client.activity({ limit: 25 });

      expect(result).toEqual({ ok: true, data: payload });

      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).toContain(`/api/companies/${COMPANY_ID}/activity`);
      expect(url).toContain("limit=25");
      expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${BOARD_KEY}`);
    });

    it("returns {ok:false} on non-2xx", async () => {
      globalThis.fetch = mockFetch(503, { error: "Service Unavailable" });
      const client = await getClient();
      const result = await client.activity({ limit: 10 });
      expect(result.ok).toBe(false);
    });
  });

  // ── agents ─────────────────────────────────────────────────────────────────

  describe("agents", () => {
    const payload = [
      { id: "a1", name: "Alice", status: "active", companyId: COMPANY_ID },
    ];

    it("calls the correct path with bearer auth and returns parsed data", async () => {
      globalThis.fetch = mockFetch(200, payload);
      const client = await getClient();

      const result = await client.agents();

      expect(result).toEqual({ ok: true, data: payload });

      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).toContain(`/api/companies/${COMPANY_ID}/agents`);
      expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${BOARD_KEY}`);
    });

    it("returns {ok:false} on non-2xx", async () => {
      globalThis.fetch = mockFetch(404, { error: "Not Found" });
      const client = await getClient();
      const result = await client.agents();
      expect(result.ok).toBe(false);
    });
  });

  // ── health ─────────────────────────────────────────────────────────────────

  describe("health", () => {
    const payload = { status: "ok", version: "1.2.3" };

    it("calls /api/health with bearer auth and returns parsed data", async () => {
      globalThis.fetch = mockFetch(200, payload);
      const client = await getClient();

      const result = await client.health();

      expect(result).toEqual({ ok: true, data: payload });

      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/api/health`);
      expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${BOARD_KEY}`);
    });

    it("returns {ok:false} on non-2xx", async () => {
      globalThis.fetch = mockFetch(503, { status: "unhealthy", error: "database_unreachable" });
      const client = await getClient();
      const result = await client.health();
      expect(result.ok).toBe(false);
    });
  });

  // ── fetch error (network failure) ─────────────────────────────────────────

  describe("network failure", () => {
    it("returns {ok:false} when fetch throws", async () => {
      globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error("ECONNREFUSED"));
      const client = await getClient();
      const result = await client.health();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/ECONNREFUSED/i);
    });
  });
});
