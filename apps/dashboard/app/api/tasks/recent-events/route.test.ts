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
import type { RecentRunEvent } from "./route";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeHeartbeatRun(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "run-1",
    companyId: "co-1",
    agentId: "agent-1",
    status: "running",
    invocationSource: "timer",
    triggerDetail: null,
    startedAt: "2026-06-17T10:00:00Z",
    finishedAt: null,
    createdAt: "2026-06-17T10:00:00Z",
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

describe("/api/tasks/recent-events — Hermes path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDataSource.mockReturnValue("hermes");
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it("returns rows mapped to the chart's event contract", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: "t1",
          kind: "curator",
          status: "running",
          at: "2026-05-29T12:00:00Z",
        },
        {
          id: "t2",
          kind: "daily-brief",
          status: "done",
          at: "2026-05-29T11:55:00Z",
        },
      ],
    });

    const res = await GET(new Request("http://localhost/api/tasks/recent-events"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.windowMin).toBe(60);
    expect(body.events).toEqual([
      { at: "2026-05-29T12:00:00Z", status: "running", kind: "curator", id: "t1" },
      { at: "2026-05-29T11:55:00Z", status: "done", kind: "daily-brief", id: "t2" },
    ]);
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });

  it("honors a custom windowMin within the 24h ceiling", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await GET(
      new Request("http://localhost/api/tasks/recent-events?windowMin=180"),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).windowMin).toBe(180);
    expect(mockQuery.mock.calls[0][1]).toEqual([180]);
  });

  it("clamps windowMin to the 24h ceiling", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await GET(
      new Request("http://localhost/api/tasks/recent-events?windowMin=99999"),
    );
    expect((await res.json()).windowMin).toBe(24 * 60);
    expect(mockQuery.mock.calls[0][1]).toEqual([24 * 60]);
  });

  it("falls back to the 60-min default for invalid windowMin", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await GET(
      new Request("http://localhost/api/tasks/recent-events?windowMin=abc"),
    );
    expect((await res.json()).windowMin).toBe(60);
  });

  it("uses started_at for running tasks and ended_at for terminal ones (SQL inspection)", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await GET(new Request("http://localhost/api/tasks/recent-events"));
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/WHEN status = 'running' THEN started_at/);
    expect(sql).toMatch(/ELSE ended_at/);
    expect(sql).toMatch(/status IN \('done', 'failed'\)/);
  });
});

// ---------------------------------------------------------------------------
// Tests — Paperclip path
// ---------------------------------------------------------------------------

describe("GET /api/tasks/recent-events — Paperclip path", () => {
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

  it("maps heartbeatRuns to { events: RecentRunEvent[], windowMin } shape", async () => {
    // Use timestamps within the 60-min window so the cutoff filter passes.
    const now = Date.now();
    const at1 = new Date(now - 10 * 60 * 1000).toISOString();
    const at2 = new Date(now - 8 * 60 * 1000).toISOString();
    const at3 = new Date(now - 5 * 60 * 1000).toISOString();

    mockHeartbeatRuns.mockResolvedValueOnce({
      ok: true,
      data: [
        makeHeartbeatRun({
          id: "r1",
          status: "running",
          invocationSource: "timer",
          startedAt: at1,
        }),
        makeHeartbeatRun({
          id: "r2",
          status: "succeeded",
          invocationSource: "assignment",
          startedAt: at1,
          finishedAt: at2,
        }),
        makeHeartbeatRun({
          id: "r3",
          status: "failed",
          invocationSource: "on_demand",
          startedAt: at1,
          finishedAt: at3,
        }),
      ],
    });

    const res = await GET(new Request("http://localhost/api/tasks/recent-events"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty("events");
    expect(body).toHaveProperty("windowMin");
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events).toHaveLength(3);

    const byId = Object.fromEntries(
      body.events.map((e: RecentRunEvent) => [e.id, e]),
    );

    // running → at is startedAt
    expect(byId["r1"].status).toBe("running");
    expect(byId["r1"].kind).toBe("timer");
    expect(byId["r1"].at).toBe(at1);

    // succeeded → done, at is finishedAt
    expect(byId["r2"].status).toBe("done");
    expect(byId["r2"].kind).toBe("assignment");
    expect(byId["r2"].at).toBe(at2);

    // failed → failed, at is finishedAt
    expect(byId["r3"].status).toBe("failed");
    expect(byId["r3"].kind).toBe("on_demand");
    expect(byId["r3"].at).toBe(at3);

    // Hermes DB must not be touched.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("excludes queued and scheduled_retry (chart vocabulary is running|done|failed only)", async () => {
    const recentAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    mockHeartbeatRuns.mockResolvedValueOnce({
      ok: true,
      data: [
        makeHeartbeatRun({ id: "q1", status: "queued", startedAt: recentAt }),
        makeHeartbeatRun({ id: "q2", status: "scheduled_retry", startedAt: recentAt }),
        makeHeartbeatRun({ id: "q3", status: "running", startedAt: recentAt }),
      ],
    });

    const res = await GET(new Request("http://localhost/api/tasks/recent-events"));
    const body = await res.json();

    expect(body.events).toHaveLength(1);
    expect(body.events[0].id).toBe("q3");
  });

  it("maps timed_out → failed and cancelled → done", async () => {
    // Use timestamps within the 60-min window so the cutoff filter passes.
    const recentAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    mockHeartbeatRuns.mockResolvedValueOnce({
      ok: true,
      data: [
        makeHeartbeatRun({
          id: "t1",
          status: "timed_out",
          finishedAt: recentAt,
        }),
        makeHeartbeatRun({
          id: "t2",
          status: "cancelled",
          finishedAt: recentAt,
        }),
      ],
    });

    const res = await GET(new Request("http://localhost/api/tasks/recent-events"));
    const body = await res.json();
    const statusById = Object.fromEntries(
      body.events.map((e: { id: string; status: string }) => [e.id, e.status]),
    );
    expect(statusById["t1"]).toBe("failed");
    expect(statusById["t2"]).toBe("done");
  });

  it("returns 503 with {error} when heartbeatRuns fails", async () => {
    mockHeartbeatRuns.mockResolvedValueOnce({ ok: false, error: "timeout" });

    const res = await GET(new Request("http://localhost/api/tasks/recent-events"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 503 when Paperclip env vars are missing", async () => {
    delete process.env.PAPERCLIP_API_URL;

    const res = await GET(new Request("http://localhost/api/tasks/recent-events"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });
});
