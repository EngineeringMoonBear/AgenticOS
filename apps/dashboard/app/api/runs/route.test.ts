import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the Paperclip client factory so the route never touches the network.
// vi.mock is hoisted to the top of the file, so the factory cannot reference
// variables declared in this module. We use vi.hoisted() to lift the shared
// spies into the hoisted scope.
// ---------------------------------------------------------------------------

const { mockHeartbeatRuns, mockCreatePaperclipClient } = vi.hoisted(() => {
  const mockHeartbeatRuns = vi.fn();
  const mockCreatePaperclipClient = vi.fn(() => ({
    heartbeatRuns: mockHeartbeatRuns,
  }));
  return { mockHeartbeatRuns, mockCreatePaperclipClient };
});

vi.mock("@/lib/paperclip/client", () => ({
  createPaperclipClient: mockCreatePaperclipClient,
}));

// Import after mocks are registered.
import { GET } from "./route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/runs");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString());
}

// A minimal HeartbeatRun fixture that exercises all mapped fields.
const heartbeatRunFixtures = [
  {
    id: "run-001",
    companyId: "co-test",
    agentId: "agent-alpha",
    status: "completed",
    invocationSource: "cron",
    triggerDetail: null,
    startedAt: "2026-06-17T10:00:00.000Z",
    finishedAt: "2026-06-17T10:02:30.000Z",
    createdAt: "2026-06-17T09:59:59.000Z",
    livenessState: null,
    livenessReason: null,
    contextSnapshot: null,
    resultJson: { costCents: 420 },
  },
  {
    id: "run-002",
    companyId: "co-test",
    agentId: "agent-beta",
    status: "running",
    invocationSource: "manual",
    triggerDetail: null,
    startedAt: "2026-06-17T10:05:00.000Z",
    finishedAt: null,
    createdAt: "2026-06-17T10:04:59.000Z",
    livenessState: "alive",
    livenessReason: null,
    contextSnapshot: null,
    resultJson: null,
  },
  {
    id: "run-003",
    companyId: "co-test",
    agentId: "agent-gamma",
    status: "queued",
    invocationSource: "cron",
    triggerDetail: null,
    startedAt: "2026-06-17T10:10:00.000Z",
    finishedAt: null,
    createdAt: "2026-06-17T10:09:59.000Z",
    livenessState: null,
    livenessReason: null,
    contextSnapshot: null,
    resultJson: null,
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/runs", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Re-attach factory after resetAllMocks clears return values.
    mockCreatePaperclipClient.mockReturnValue({
      heartbeatRuns: mockHeartbeatRuns,
    });
    // Provide env vars for the config-guard tests that need them.
    process.env.PAPERCLIP_API_URL = "https://paperclip.test";
    process.env.PAPERCLIP_BOARD_KEY = "test-board-key";
    process.env.PAPERCLIP_COMPANY_ID = "co-test";
  });

  it("maps heartbeat-runs to RunRecord shape with correct field values", async () => {
    mockHeartbeatRuns.mockResolvedValue({
      ok: true,
      data: heartbeatRunFixtures,
    });

    const res = await GET(makeRequest({ limit: "50" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("runs");
    expect(body.runs).toHaveLength(3);

    // First run — completed with costCents in resultJson
    const run0 = body.runs[0];
    expect(run0.id).toBe("run-001");
    expect(run0.agent).toBe("agent-alpha");
    expect(run0.status).toBe("completed");
    expect(run0.startedAt).toBe("2026-06-17T10:00:00.000Z");
    expect(run0.endedAt).toBe("2026-06-17T10:02:30.000Z");
    // costCents from resultJson mapped to costUsd (divide by 100)
    expect(run0.costUsd).toBeCloseTo(4.20, 5);
    // numeric fields default to 0 when not available in heartbeat payload
    expect(run0.inputTokens).toBe(0);
    expect(run0.outputTokens).toBe(0);
    expect(run0.cacheReadTokens).toBe(0);
    expect(run0.cacheCreationTokens).toBe(0);
    expect(run0.toolCalls).toBe(0);
    expect(run0.errorMessage).toBeNull();

    // Second run — running, no finishedAt
    const run1 = body.runs[1];
    expect(run1.id).toBe("run-002");
    expect(run1.agent).toBe("agent-beta");
    expect(run1.status).toBe("running");
    expect(run1.endedAt).toBeNull();
    expect(run1.costUsd).toBe(0);
  });

  it("includes a live subset (status queued|running) in response.live", async () => {
    mockHeartbeatRuns.mockResolvedValue({
      ok: true,
      data: heartbeatRunFixtures,
    });

    const res = await GET(makeRequest({ limit: "50" }));
    const body = await res.json();

    expect(body).toHaveProperty("live");
    // run-002 (running) and run-003 (queued) are live; run-001 (completed) is not
    expect(body.live).toHaveLength(2);
    const liveIds = body.live.map((r: { id: string }) => r.id);
    expect(liveIds).toContain("run-002");
    expect(liveIds).toContain("run-003");
    expect(liveIds).not.toContain("run-001");
  });

  it("forwards limit query param to heartbeatRuns", async () => {
    mockHeartbeatRuns.mockResolvedValue({ ok: true, data: [] });

    await GET(makeRequest({ limit: "25" }));

    expect(mockHeartbeatRuns).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 25 }),
    );
  });

  it("returns 503 with {error} when heartbeatRuns fails", async () => {
    mockHeartbeatRuns.mockResolvedValue({
      ok: false,
      error: "HTTP 502 Bad Gateway",
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(typeof body.error).toBe("string");
    expect(body.error).toContain("HTTP 502 Bad Gateway");
  });

  it("returns 503 when env vars are missing", async () => {
    delete process.env.PAPERCLIP_API_URL;
    delete process.env.PAPERCLIP_BOARD_KEY;
    delete process.env.PAPERCLIP_COMPANY_ID;

    const res = await GET(makeRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    // Client factory must NOT have been called — no config available.
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });
});
