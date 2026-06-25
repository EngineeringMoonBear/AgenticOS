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
// Fixture helper
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

describe("/api/tasks/queue-depth — Hermes path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDataSource.mockReturnValue("hermes");
  });

  it("returns { rows, asOf1hCount } from DB and does NOT call Paperclip", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ kind: "curator", status: "running", count: 2 }],
      })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toEqual([{ kind: "curator", status: "running", count: 2 }]);
    expect(body.asOf1hCount).toBe(1);
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — Paperclip path
// ---------------------------------------------------------------------------

describe("GET /api/tasks/queue-depth — Paperclip path", () => {
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

  it("groups live runs by (kind, status) and excludes terminal runs", async () => {
    const startedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    mockHeartbeatRuns.mockResolvedValueOnce({
      ok: true,
      data: [
        makeRun({ id: "r1", status: "running", invocationSource: "timer", startedAt }),
        makeRun({ id: "r2", status: "running", invocationSource: "timer", startedAt }),
        makeRun({ id: "r3", status: "queued", invocationSource: "assignment", startedAt }),
        // Terminal — excluded from the depth.
        makeRun({ id: "r4", status: "succeeded", startedAt }),
        makeRun({ id: "r5", status: "cancelled", startedAt }),
      ],
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    // Sorted by kind, then status.
    expect(body.rows).toEqual([
      { kind: "assignment", status: "queued", count: 1 },
      { kind: "timer", status: "running", count: 2 },
    ]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("counts runs that were in-flight one hour ago in asOf1hCount", async () => {
    const min = 60 * 1000;
    const now = Date.now();
    mockHeartbeatRuns.mockResolvedValueOnce({
      ok: true,
      data: [
        // Started 90m ago, still running → in-flight 1h ago ✓
        makeRun({
          id: "a",
          status: "running",
          startedAt: new Date(now - 90 * min).toISOString(),
          finishedAt: null,
        }),
        // Started 90m ago, finished 30m ago → in-flight 1h ago ✓
        makeRun({
          id: "b",
          status: "succeeded",
          startedAt: new Date(now - 90 * min).toISOString(),
          finishedAt: new Date(now - 30 * min).toISOString(),
        }),
        // Started 90m ago, finished 80m ago → ended before the 1h mark ✗
        makeRun({
          id: "c",
          status: "succeeded",
          startedAt: new Date(now - 90 * min).toISOString(),
          finishedAt: new Date(now - 80 * min).toISOString(),
        }),
        // Started 5m ago → not yet started 1h ago ✗
        makeRun({
          id: "d",
          status: "running",
          startedAt: new Date(now - 5 * min).toISOString(),
          finishedAt: null,
        }),
      ],
    });

    const res = await GET();
    const body = await res.json();
    expect(body.asOf1hCount).toBe(2);
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
