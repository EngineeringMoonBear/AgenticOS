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
  const bodyText = typeof body === "string" ? body : JSON.stringify(body);
  return vi.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    text: async () => bodyText,
    json: async () => {
      if (typeof body === "string") throw new SyntaxError("Unexpected token");
      return body;
    },
  });
}

function mockFetchNonJsonBody(status: number, statusText: string, bodyText: string) {
  return vi.fn().mockResolvedValueOnce({
    ok: false,
    status,
    statusText,
    text: async () => bodyText,
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
      if (!result.ok) expect(result.error).toMatch(/500/);
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

    it("forwards agentId as a query param when provided", async () => {
      globalThis.fetch = mockFetch(200, payload);
      const client = await getClient();
      await client.heartbeatRuns({ limit: 1, agentId: "agent-xyz" });
      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).toContain("agentId=agent-xyz");
      expect(url).toContain("limit=1");
    });

    it("omits agentId from query string when not provided", async () => {
      globalThis.fetch = mockFetch(200, payload);
      const client = await getClient();
      await client.heartbeatRuns({ limit: 50 });
      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).not.toContain("agentId=");
    });

    it("returns {ok:false} on non-2xx", async () => {
      globalThis.fetch = mockFetch(401, { error: "Unauthorized" });
      const client = await getClient();
      const result = await client.heartbeatRuns({ limit: 10 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/401/);
    });
  });

  // ── activity ───────────────────────────────────────────────────────────────

  describe("activity", () => {
    // Real ActivityItem shape includes runId (nullable uuid).
    // Source: vendor/paperclip/packages/db/src/schema/activity_log.ts
    const payload = [
      {
        id: "act-1",
        companyId: COMPANY_ID,
        actorType: "agent",
        actorId: "a1",
        agentId: "a1",
        runId: "run-123",
        action: "issue.created",
        entityType: "issue",
        entityId: "i1",
        details: null,
        createdAt: "2024-01-01T00:00:00Z",
      },
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

  // ── costByPeriod ───────────────────────────────────────────────────────────

  describe("costByPeriod", () => {
    const payload = [
      { date: "2024-01-01", costCents: 1200 },
      { date: "2024-01-02", costCents: 800 },
    ];

    it("calls the correct path with bearer auth and returns parsed data", async () => {
      globalThis.fetch = mockFetch(200, payload);
      const client = await getClient();

      const result = await client.costByPeriod({ from: "2024-01-01", to: "2024-01-31", bucket: "day" });

      expect(result).toEqual({ ok: true, data: payload });

      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).toContain(`/api/companies/${COMPANY_ID}/costs/by-period`);
      expect(url).toContain("from=2024-01-01");
      expect(url).toContain("to=2024-01-31");
      expect(url).toContain("bucket=day");
      expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${BOARD_KEY}`);
    });

    it("omits optional params when not provided", async () => {
      globalThis.fetch = mockFetch(200, payload);
      const client = await getClient();
      await client.costByPeriod({});
      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).not.toContain("from=");
      expect(url).not.toContain("to=");
      expect(url).not.toContain("bucket=");
    });

    it("returns {ok:false} on non-2xx", async () => {
      globalThis.fetch = mockFetch(500, { error: "Internal Server Error" });
      const client = await getClient();
      const result = await client.costByPeriod({});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/500/);
    });
  });

  // ── issues ─────────────────────────────────────────────────────────────────

  describe("issues", () => {
    // Real Issue shape: no `assignee` field; split into assigneeAgentId + assigneeUserId.
    // Source: vendor/paperclip/packages/shared/src/types/issue.ts
    const payload = [
      {
        id: "iss-1",
        companyId: COMPANY_ID,
        title: "Agent failing",
        status: "in_progress",
        priority: "high",
        assigneeAgentId: "a1",
        assigneeUserId: null,
        identifier: "DEMO-1",
        issueNumber: 1,
        workMode: "normal",
        successfulRunHandoff: null,
        activeRecoveryAction: null,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
      },
    ];

    it("calls the correct path with bearer auth and returns parsed data", async () => {
      globalThis.fetch = mockFetch(200, payload);
      const client = await getClient();

      const result = await client.issues({ status: "open", limit: 20 });

      expect(result).toEqual({ ok: true, data: payload });

      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).toContain(`/api/companies/${COMPANY_ID}/issues`);
      expect(url).toContain("status=open");
      expect(url).toContain("limit=20");
      expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${BOARD_KEY}`);
    });

    it("omits optional params when not provided", async () => {
      globalThis.fetch = mockFetch(200, payload);
      const client = await getClient();
      await client.issues({});
      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).not.toContain("status=");
      expect(url).not.toContain("limit=");
    });

    it("returns {ok:false} on non-2xx", async () => {
      globalThis.fetch = mockFetch(403, { error: "Forbidden" });
      const client = await getClient();
      const result = await client.issues({});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/403/);
    });
  });

  // ── routines ───────────────────────────────────────────────────────────────

  describe("routines", () => {
    // Real RoutineListItem shape: no `name` (field is `title`), no `schedule` (cron lives in
    // triggers[].cronExpression), no top-level `nextRunAt` (lives in triggers[].nextRunAt).
    // Source: vendor/paperclip/packages/shared/src/types/routine.ts (RoutineListItem)
    const payload = [
      {
        id: "rtn-1",
        companyId: COMPANY_ID,
        title: "Daily report",
        status: "active",
        priority: "normal",
        assigneeAgentId: "a1",
        concurrencyPolicy: "skip",
        catchUpPolicy: "skip_missed",
        lastTriggeredAt: null,
        lastEnqueuedAt: null,
        managedByPlugin: null,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        triggers: [
          {
            id: "trg-1",
            kind: "cron",
            label: "Daily 9am",
            enabled: true,
            cronExpression: "0 9 * * *",
            timezone: "UTC",
            nextRunAt: "2024-01-02T09:00:00Z",
            lastFiredAt: null,
            lastResult: null,
          },
        ],
        lastRun: null,
        activeIssue: null,
      },
    ];

    it("calls the correct path with bearer auth and returns parsed data", async () => {
      globalThis.fetch = mockFetch(200, payload);
      const client = await getClient();

      const result = await client.routines();

      expect(result).toEqual({ ok: true, data: payload });

      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).toContain(`/api/companies/${COMPANY_ID}/routines`);
      expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${BOARD_KEY}`);
    });

    it("returns {ok:false} on non-2xx", async () => {
      globalThis.fetch = mockFetch(404, { error: "Not Found" });
      const client = await getClient();
      const result = await client.routines();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/404/);
    });
  });

  // ── org ────────────────────────────────────────────────────────────────────

  describe("org", () => {
    // Real OrgNode shape: nested tree via toLeanOrgNode() — NOT flat with parentId.
    // Fields `type` and `parentId` do NOT exist. Real fields: role, status, reports[].
    // Source: vendor/paperclip/server/src/routes/agents.ts, toLeanOrgNode() at line 1430
    const payload = [
      {
        id: "node-1",
        name: "Bob",
        role: "ceo",
        status: "active",
        reports: [
          { id: "node-2", name: "Alice", role: "ic", status: "active", reports: [] },
        ],
      },
    ];

    it("calls the correct path with bearer auth and returns parsed data", async () => {
      globalThis.fetch = mockFetch(200, payload);
      const client = await getClient();

      const result = await client.org();

      expect(result).toEqual({ ok: true, data: payload });

      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).toContain(`/api/companies/${COMPANY_ID}/org`);
      expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${BOARD_KEY}`);
    });

    it("returns {ok:false} on non-2xx", async () => {
      globalThis.fetch = mockFetch(401, { error: "Unauthorized" });
      const client = await getClient();
      const result = await client.org();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/401/);
    });
  });

  // ── approvals ──────────────────────────────────────────────────────────────

  describe("approvals", () => {
    // Real Approval shape: no `title`, no single `requestedBy`.
    // Has: type (ApprovalType), requestedByAgentId, requestedByUserId, payload (redacted).
    // Source: vendor/paperclip/packages/shared/src/types/approval.ts
    const payload = [
      {
        id: "appr-1",
        companyId: COMPANY_ID,
        type: "budget_override_required",
        requestedByAgentId: "a1",
        requestedByUserId: null,
        status: "pending",
        payload: "[redacted]",
        decisionNote: null,
        decidedByUserId: null,
        decidedAt: null,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
    ];

    it("calls the correct path with bearer auth and returns parsed data", async () => {
      globalThis.fetch = mockFetch(200, payload);
      const client = await getClient();

      const result = await client.approvals({ status: "pending" });

      expect(result).toEqual({ ok: true, data: payload });

      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).toContain(`/api/companies/${COMPANY_ID}/approvals`);
      expect(url).toContain("status=pending");
      expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${BOARD_KEY}`);
    });

    it("omits status param when not provided", async () => {
      globalThis.fetch = mockFetch(200, payload);
      const client = await getClient();
      await client.approvals({});
      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).not.toContain("status=");
    });

    it("returns {ok:false} on non-2xx", async () => {
      globalThis.fetch = mockFetch(403, { error: "Forbidden" });
      const client = await getClient();
      const result = await client.approvals({});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/403/);
    });
  });

  // ── schedulerHeartbeats ────────────────────────────────────────────────────

  describe("schedulerHeartbeats", () => {
    // InstanceSchedulerHeartbeatAgent shape from vendor/paperclip/packages/shared/src/types/heartbeat.ts
    // NOTE: Does NOT expose plugin-job data (no vault-ingest/pr-triage last-run or next-run).
    const payload = [
      {
        id: "a1",
        companyId: COMPANY_ID,
        companyName: "Demo Corp",
        companyIssuePrefix: "DEMO",
        agentName: "Alice",
        agentUrlKey: "alice",
        role: "ic",
        title: null,
        status: "active",
        adapterType: "acpx_local",
        intervalSec: 300,
        heartbeatEnabled: true,
        schedulerActive: true,
        lastHeartbeatAt: "2024-01-01T00:00:00Z",
      },
    ];

    it("calls /api/instance/scheduler-heartbeats with bearer auth", async () => {
      globalThis.fetch = mockFetch(200, payload);
      const client = await getClient();

      const result = await client.schedulerHeartbeats();

      expect(result).toEqual({ ok: true, data: payload });

      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/api/instance/scheduler-heartbeats");
      expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${BOARD_KEY}`);
    });

    it("does NOT include companyId in the URL path", async () => {
      globalThis.fetch = mockFetch(200, payload);
      const client = await getClient();
      await client.schedulerHeartbeats();
      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).not.toContain(`/companies/${COMPANY_ID}`);
    });

    it("returns {ok:false} on non-2xx", async () => {
      globalThis.fetch = mockFetch(403, { error: "Forbidden" });
      const client = await getClient();
      const result = await client.schedulerHeartbeats();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/403/);
    });
  });

  // ── non-JSON error body (e.g. 502 gateway with HTML page) ─────────────────

  describe("non-JSON error body", () => {
    it("surfaces the HTTP status in error when body is non-JSON", async () => {
      globalThis.fetch = mockFetchNonJsonBody(
        502,
        "Bad Gateway",
        "<html><body>Bad Gateway</body></html>",
      );
      const client = await getClient();
      const result = await client.health();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        // Must contain the status code — must NOT be a JSON-parse error message
        expect(result.error).toMatch(/502/);
        expect(result.error).not.toMatch(/JSON|SyntaxError|Unexpected token/i);
      }
    });

    it("surfaces the HTTP status in error when body is empty", async () => {
      globalThis.fetch = mockFetchNonJsonBody(502, "Bad Gateway", "");
      const client = await getClient();
      const result = await client.health();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/502/);
        expect(result.error).not.toMatch(/JSON|SyntaxError|Unexpected token/i);
      }
    });
  });
});
