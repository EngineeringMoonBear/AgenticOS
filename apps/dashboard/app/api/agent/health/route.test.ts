import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the Paperclip client factory so the route never touches the network.
// vi.mock is hoisted to the top of the file; use vi.hoisted() to lift spies.
// ---------------------------------------------------------------------------

const { mockHealth, mockAgents, mockHeartbeatRuns, mockCreatePaperclipClient } =
  vi.hoisted(() => {
    const mockHealth = vi.fn();
    const mockAgents = vi.fn();
    const mockHeartbeatRuns = vi.fn();
    const mockCreatePaperclipClient = vi.fn(() => ({
      health: mockHealth,
      agents: mockAgents,
      heartbeatRuns: mockHeartbeatRuns,
    }));
    return { mockHealth, mockAgents, mockHeartbeatRuns, mockCreatePaperclipClient };
  });

vi.mock("@/lib/paperclip/client", () => ({
  createPaperclipClient: mockCreatePaperclipClient,
}));

// Mock the Hermes client so the existing path is tested in isolation.
const { mockListTasks, mockGetHermesClient } = vi.hoisted(() => {
  const mockListTasks = vi.fn();
  const mockGetHermesClient = vi.fn(() => ({ listTasks: mockListTasks }));
  return { mockListTasks, mockGetHermesClient };
});

vi.mock("@/lib/agent", () => ({
  getHermesClient: mockGetHermesClient,
}));

// Import after mocks are registered.
import { GET } from "./route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest() {
  return new Request("http://localhost/api/agent/health");
}

// ---------------------------------------------------------------------------
// Tests — Paperclip path (DASHBOARD_DATA_SOURCE=paperclip)
// ---------------------------------------------------------------------------

describe("GET /api/agent/health — Paperclip path (DASHBOARD_DATA_SOURCE=paperclip)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Re-attach factory after resetAllMocks clears return values.
    mockCreatePaperclipClient.mockReturnValue({
      health: mockHealth,
      agents: mockAgents,
      heartbeatRuns: mockHeartbeatRuns,
    });
    // Activate Paperclip path.
    process.env.DASHBOARD_DATA_SOURCE = "paperclip";
    // Provide Paperclip env config.
    process.env.PAPERCLIP_API_URL = "https://paperclip.test";
    process.env.PAPERCLIP_BOARD_KEY = "test-board-key";
    process.env.PAPERCLIP_COMPANY_ID = "co-test";
  });

  afterEach(() => {
    delete process.env.DASHBOARD_DATA_SOURCE;
    delete process.env.PAPERCLIP_API_URL;
    delete process.env.PAPERCLIP_BOARD_KEY;
    delete process.env.PAPERCLIP_COMPANY_ID;
  });

  it('returns status "ok" when health passes, an agent is running, and latest run is not stuck', async () => {
    mockHealth.mockResolvedValue({ ok: true, data: { status: "ok" } });
    mockAgents.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "agent-1",
          companyId: "co-test",
          name: "Daily Brief",
          status: "running",
          role: null,
          title: null,
          adapterType: null,
          budgetMonthlyCents: 5000,
          spentMonthlyCents: 1000,
        },
      ],
    });
    mockHeartbeatRuns.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "run-1",
          companyId: "co-test",
          agentId: "agent-1",
          status: "running",
          invocationSource: "cron",
          triggerDetail: null,
          startedAt: "2026-06-17T10:00:00.000Z",
          finishedAt: null,
          createdAt: "2026-06-17T09:59:59.000Z",
          livenessState: "alive",
          livenessReason: null,
          contextSnapshot: null,
          resultJson: null,
        },
      ],
    });

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it('returns status "degraded" when health passes but no agent is running', async () => {
    mockHealth.mockResolvedValue({ ok: true, data: { status: "ok" } });
    mockAgents.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "agent-1",
          companyId: "co-test",
          name: "Daily Brief",
          status: "idle",
          role: null,
          title: null,
          adapterType: null,
          budgetMonthlyCents: 5000,
          spentMonthlyCents: 1000,
        },
      ],
    });

    const res = await GET();
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.status).toBe("degraded");
  });

  it('returns status "degraded" when health passes, agent is running, but latest run is stuck', async () => {
    mockHealth.mockResolvedValue({ ok: true, data: { status: "ok" } });
    mockAgents.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "agent-1",
          companyId: "co-test",
          name: "Daily Brief",
          status: "running",
          role: null,
          title: null,
          adapterType: null,
          budgetMonthlyCents: 5000,
          spentMonthlyCents: 1000,
        },
      ],
    });
    mockHeartbeatRuns.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "run-1",
          companyId: "co-test",
          agentId: "agent-1",
          status: "running",
          invocationSource: "cron",
          triggerDetail: null,
          startedAt: "2026-06-17T10:00:00.000Z",
          finishedAt: null,
          createdAt: "2026-06-17T09:59:59.000Z",
          livenessState: "stuck",
          livenessReason: "no heartbeat for 5 minutes",
          contextSnapshot: null,
          resultJson: null,
        },
      ],
    });

    const res = await GET();
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.status).toBe("degraded");
  });

  it('returns status "down" with 503 when health() fails', async () => {
    mockHealth.mockResolvedValue({ ok: false, error: "HTTP 503 Service Unavailable" });

    const res = await GET();
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.status).toBe("down");
  });

  it("returns 503 when Paperclip env vars are missing", async () => {
    delete process.env.PAPERCLIP_API_URL;
    delete process.env.PAPERCLIP_BOARD_KEY;
    delete process.env.PAPERCLIP_COMPANY_ID;

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    // Client factory must NOT have been called — no config available.
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — Hermes path (env var unset / anything other than "paperclip")
// ---------------------------------------------------------------------------

describe("GET /api/agent/health — Hermes path (DASHBOARD_DATA_SOURCE unset)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetHermesClient.mockReturnValue({ listTasks: mockListTasks });
    // Ensure Paperclip path is NOT active.
    delete process.env.DASHBOARD_DATA_SOURCE;
  });

  afterEach(() => {
    delete process.env.DASHBOARD_DATA_SOURCE;
  });

  it("uses Hermes and does NOT call the Paperclip client when DASHBOARD_DATA_SOURCE is unset", async () => {
    mockListTasks.mockResolvedValue([]);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body).toHaveProperty("hermes");

    // Paperclip client must not be called.
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });

  it("returns degraded with 503 when Hermes listTasks throws", async () => {
    mockListTasks.mockRejectedValue(new Error("connection refused"));

    const res = await GET();
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.status).toBe("degraded");
    expect(body).toHaveProperty("hermes");
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });
});
