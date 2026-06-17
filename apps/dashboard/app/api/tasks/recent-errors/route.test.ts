import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the Paperclip client factory (hoisted so vi.mock can use it).
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

// Mock the Hermes DB pool (Hermes path — must not regress).
const { mockQuery } = vi.hoisted(() => {
  const mockQuery = vi.fn().mockResolvedValue({
    rows: [
      {
        id: "hermes-task-1",
        kind: "curator",
        error: "DB error",
        started_at: "2026-06-17T09:00:00Z",
      },
    ],
  });
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
  return {
    id: "run-1",
    companyId: "co-1",
    agentId: "agent-1",
    status: "failed",
    invocationSource: "timer",
    triggerDetail: null,
    startedAt: "2026-06-17T10:00:00.000Z",
    finishedAt: "2026-06-17T10:05:00.000Z",
    createdAt: "2026-06-17T09:59:58.000Z",
    livenessState: "failed",
    livenessReason: null,
    contextSnapshot: null,
    resultJson: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — Hermes path (must not regress)
// ---------------------------------------------------------------------------

describe("GET /api/tasks/recent-errors — Hermes path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDataSource.mockReturnValue("hermes");
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: "hermes-task-1",
          kind: "curator",
          error: "DB error",
          started_at: "2026-06-17T09:00:00Z",
        },
      ],
    });
  });

  it("returns { rows } from DB and does NOT call Paperclip", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("rows");
    expect(body.rows[0].id).toBe("hermes-task-1");
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — Paperclip path
// ---------------------------------------------------------------------------

describe("GET /api/tasks/recent-errors — Paperclip path", () => {
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

  it("maps failed/timed_out runs to RecentErrorRow shape", async () => {
    mockHeartbeatRuns.mockResolvedValue({
      ok: true,
      data: [
        makeRun({ id: "r1", status: "failed", invocationSource: "timer" }),
        makeRun({ id: "r2", status: "timed_out", invocationSource: "assignment" }),
        // Terminal non-failure statuses must be excluded
        makeRun({ id: "r3", status: "succeeded" }),
        makeRun({ id: "r4", status: "cancelled" }),
        // Live statuses must be excluded
        makeRun({ id: "r5", status: "running" }),
        makeRun({ id: "r6", status: "queued" }),
      ],
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty("rows");
    expect(body.rows).toHaveLength(2);
    const ids = body.rows.map((r: { id: string }) => r.id);
    expect(ids).toContain("r1");
    expect(ids).toContain("r2");
    // Non-failed runs must be excluded
    expect(ids).not.toContain("r3");
    expect(ids).not.toContain("r4");
    expect(ids).not.toContain("r5");
    expect(ids).not.toContain("r6");

    // Hermes DB must not be touched.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("maps fields to exact RecentErrorRow shape: id, kind, error, started_at", async () => {
    mockHeartbeatRuns.mockResolvedValue({
      ok: true,
      data: [
        makeRun({
          id: "r1",
          status: "failed",
          invocationSource: "on_demand",
          startedAt: "2026-06-17T10:00:00.000Z",
          livenessReason: null,
        }),
      ],
    });

    const res = await GET();
    const body = await res.json();
    const row = body.rows[0];

    expect(row.id).toBe("r1");
    // kind ← invocationSource
    expect(row.kind).toBe("on_demand");
    // error is null when livenessReason is null
    expect(row.error).toBeNull();
    // started_at ← startedAt
    expect(row.started_at).toBe("2026-06-17T10:00:00.000Z");
  });

  it("uses createdAt as started_at fallback when startedAt is null", async () => {
    mockHeartbeatRuns.mockResolvedValue({
      ok: true,
      data: [
        makeRun({
          id: "r1",
          status: "failed",
          startedAt: null,
          createdAt: "2026-06-17T09:59:58.000Z",
        }),
      ],
    });

    const res = await GET();
    const body = await res.json();
    expect(body.rows[0].started_at).toBe("2026-06-17T09:59:58.000Z");
  });

  it("sets error to livenessReason when livenessState is 'failed'", async () => {
    mockHeartbeatRuns.mockResolvedValue({
      ok: true,
      data: [
        makeRun({
          id: "r1",
          status: "failed",
          livenessState: "failed",
          livenessReason: "stuck",
        }),
      ],
    });

    const res = await GET();
    const body = await res.json();
    expect(body.rows[0].error).toBe("stuck");
  });

  it("sets error to null when livenessState is not a failure state", async () => {
    // livenessReason present but livenessState is NOT 'failed' — error must be null.
    mockHeartbeatRuns.mockResolvedValue({
      ok: true,
      data: [
        makeRun({
          id: "r1",
          status: "failed",
          livenessState: "completed",
          livenessReason: "Agent created a document revision",
        }),
      ],
    });

    const res = await GET();
    const body = await res.json();
    expect(body.rows[0].error).toBeNull();
  });

  it("sets error to null when livenessState and livenessReason are both null", async () => {
    mockHeartbeatRuns.mockResolvedValue({
      ok: true,
      data: [makeRun({ id: "r1", status: "timed_out", livenessState: null, livenessReason: null })],
    });

    const res = await GET();
    const body = await res.json();
    expect(body.rows[0].error).toBeNull();
  });

  it("uses run.error as primary error source even when livenessState is not 'failed'", async () => {
    // A timed_out run with a non-null run.error but livenessState NOT "failed".
    // run.error must appear in the output — it must NOT be dropped in favour of
    // the livenessReason fallback path.
    // Source: heartbeat_runs.ts `error text` column; heartbeat.ts:1116 (heartbeatRunListColumns)
    mockHeartbeatRuns.mockResolvedValue({
      ok: true,
      data: [
        makeRun({
          id: "r-timeout",
          status: "timed_out",
          error: "process pid 9876 lost (process_lost); retrying once",
          livenessState: "needs_followup",
          livenessReason: "Agent last output was stale",
        }),
      ],
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    // run.error wins — not null, not the livenessReason fallback
    expect(body.rows[0].error).toBe("process pid 9876 lost (process_lost); retrying once");
  });

  it("returns 503 with {error} when heartbeatRuns fails", async () => {
    mockHeartbeatRuns.mockResolvedValue({
      ok: false,
      error: "HTTP 502 Bad Gateway",
    });

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(typeof body.error).toBe("string");
  });

  it("returns 503 when Paperclip env vars are missing", async () => {
    delete process.env.PAPERCLIP_API_URL;
    delete process.env.PAPERCLIP_BOARD_KEY;
    delete process.env.PAPERCLIP_COMPANY_ID;

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });
});
