import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the Paperclip client factory.
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

// Mock the data-source flag.
const { mockDataSource } = vi.hoisted(() => {
  const mockDataSource = vi.fn(() => "hermes" as "hermes" | "paperclip");
  return { mockDataSource };
});

vi.mock("@/lib/config/data-source", () => ({
  dataSource: mockDataSource,
}));

// Mock the Hermes DB pool.
const { mockQuery } = vi.hoisted(() => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
  return { mockQuery };
});

vi.mock("@/lib/cost/db", () => ({
  getPool: vi.fn(() => ({ query: mockQuery })),
}));

// Import after mocks.
import { GET } from "./route";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<Record<string, unknown>> = {}) {
  const startedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  return {
    id: "run-1",
    companyId: "co-1",
    agentId: "agent-1",
    status: "running",
    invocationSource: "timer",
    triggerDetail: null,
    startedAt,
    finishedAt: null,
    createdAt: startedAt,
    livenessState: null,
    livenessReason: null,
    contextSnapshot: null,
    resultJson: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — Hermes path (existing behaviour — must not regress)
// ---------------------------------------------------------------------------

describe("/api/tasks/active — Hermes path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDataSource.mockReturnValue("hermes");
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it("returns { runs } from DB and does NOT call Paperclip", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: "t1",
          kind: "curator",
          started_at: "2026-06-17T10:00:00Z",
          elapsed_seconds: "300",
          heartbeat_age_seconds: "30",
        },
      ],
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("runs");
    expect(body.runs[0].id).toBe("t1");
    expect(body.runs[0].stuck).toBe(false);
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });

  it("marks a run as stuck when elapsed_seconds exceeds threshold", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: "t2",
          kind: "daily-brief",
          started_at: "2026-06-17T09:00:00Z",
          elapsed_seconds: "600",
          heartbeat_age_seconds: null,
        },
      ],
    });

    const res = await GET();
    const body = await res.json();
    expect(body.runs[0].stuck).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests — Paperclip path
// ---------------------------------------------------------------------------

describe("GET /api/tasks/active — Paperclip path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCreatePaperclipClient.mockReturnValue({ heartbeatRuns: mockHeartbeatRuns });
    mockDataSource.mockReturnValue("paperclip");
    process.env.PAPERCLIP_API_URL = "https://paperclip.test";
    process.env.PAPERCLIP_BOARD_KEY = "test-board-key";
    process.env.PAPERCLIP_COMPANY_ID = "co-test";
  });

  afterEach(() => {
    delete process.env.PAPERCLIP_API_URL;
    delete process.env.PAPERCLIP_BOARD_KEY;
    delete process.env.PAPERCLIP_COMPANY_ID;
  });

  it("maps running/queued heartbeatRuns to ActiveRun shape", async () => {
    const startedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString(); // 2 min ago
    mockHeartbeatRuns.mockResolvedValueOnce({
      ok: true,
      data: [
        makeRun({ id: "r1", status: "running", invocationSource: "timer", startedAt }),
        makeRun({ id: "r2", status: "queued", invocationSource: "assignment", startedAt }),
        // Terminal runs should be excluded
        makeRun({ id: "r3", status: "succeeded" }),
        makeRun({ id: "r4", status: "failed" }),
        makeRun({ id: "r5", status: "cancelled" }),
      ],
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty("runs");
    // Only running and queued survive
    expect(body.runs).toHaveLength(2);
    const ids = body.runs.map((r: { id: string }) => r.id);
    expect(ids).toContain("r1");
    expect(ids).toContain("r2");

    // Shape must match ActiveRun: id, kind, started_at, elapsed_seconds, stuck
    const r1 = body.runs.find((r: { id: string }) => r.id === "r1");
    expect(r1).toHaveProperty("id", "r1");
    expect(r1).toHaveProperty("kind", "timer");
    expect(r1).toHaveProperty("started_at", startedAt);
    expect(typeof r1.elapsed_seconds).toBe("number");
    expect(typeof r1.stuck).toBe("boolean");

    // Hermes DB must not be touched.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("marks a run stuck when elapsed_seconds > 300", async () => {
    // Run started 10 minutes ago → 600s elapsed → stuck by elapsed threshold (>300s)
    const startedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    mockHeartbeatRuns.mockResolvedValueOnce({
      ok: true,
      data: [makeRun({ id: "s1", status: "running", startedAt })],
    });

    const res = await GET();
    const body = await res.json();
    expect(body.runs[0].stuck).toBe(true);
  });

  it("uses invocationSource as kind", async () => {
    const startedAt = new Date(Date.now() - 30 * 1000).toISOString();
    mockHeartbeatRuns.mockResolvedValueOnce({
      ok: true,
      data: [
        makeRun({ id: "k1", status: "running", invocationSource: "automation", startedAt }),
      ],
    });

    const res = await GET();
    const body = await res.json();
    expect(body.runs[0].kind).toBe("automation");
  });

  it("returns 503 with {error} when heartbeatRuns fails", async () => {
    mockHeartbeatRuns.mockResolvedValueOnce({ ok: false, error: "network error" });

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 503 when Paperclip env vars are missing", async () => {
    delete process.env.PAPERCLIP_API_URL;

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });
});
