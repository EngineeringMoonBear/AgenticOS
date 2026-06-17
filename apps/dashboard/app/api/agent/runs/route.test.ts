import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the Paperclip client factory so the route never touches the network.
// vi.mock is hoisted to the top of the file; use vi.hoisted() to lift spies.
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

// Mock the data-source flag so we can switch between paths.
const { mockDataSource } = vi.hoisted(() => {
  const mockDataSource = vi.fn(() => "paperclip" as "hermes" | "paperclip");
  return { mockDataSource };
});

vi.mock("@/lib/config/data-source", () => ({
  dataSource: mockDataSource,
}));

// Mock node:fs/promises so the Hermes (file-read) path doesn't hit disk.
const { mockReadFile } = vi.hoisted(() => {
  const mockReadFile = vi.fn().mockResolvedValue("");
  return { mockReadFile };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: mockReadFile };
});

// Import after mocks are registered.
import { GET } from "./route";

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

function makeRequest(params?: Record<string, string>) {
  const url = new URL("http://localhost/api/agent/runs");
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  return new Request(url.toString());
}

// ---------------------------------------------------------------------------
// Tests — Paperclip path
// ---------------------------------------------------------------------------

describe("GET /api/agent/runs — Paperclip path", () => {
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

  it("maps heartbeatRuns to { runs: RunRecord[] } shape", async () => {
    mockHeartbeatRuns.mockResolvedValueOnce({
      ok: true,
      data: [
        makeHeartbeatRun({ id: "r1", status: "running", invocationSource: "timer" }),
        makeHeartbeatRun({ id: "r2", status: "succeeded", invocationSource: "assignment" }),
        makeHeartbeatRun({ id: "r3", status: "failed", invocationSource: "on_demand" }),
      ],
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("runs");
    expect(Array.isArray(body.runs)).toBe(true);
    expect(body.runs).toHaveLength(3);

    // Check RunRecord fields.
    const [r1, r2, r3] = body.runs;
    expect(r1.id).toBe("r1");
    expect(r1.status).toBe("running");
    expect(r1.agent).toBe("agent-1");
    expect(r1.inputTokens).toBe(0);
    expect(r1.outputTokens).toBe(0);
    expect(r1.toolCalls).toBe(0);

    // status mapping: succeeded → completed
    expect(r2.status).toBe("completed");

    // status mapping: failed → failed
    expect(r3.status).toBe("failed");
  });

  it("maps Paperclip status values to RunRecord statuses correctly", async () => {
    mockHeartbeatRuns.mockResolvedValueOnce({
      ok: true,
      data: [
        makeHeartbeatRun({ id: "q1", status: "queued" }),
        makeHeartbeatRun({ id: "q2", status: "scheduled_retry" }),
        makeHeartbeatRun({ id: "q3", status: "running" }),
        makeHeartbeatRun({ id: "q4", status: "succeeded" }),
        makeHeartbeatRun({ id: "q5", status: "failed" }),
        makeHeartbeatRun({ id: "q6", status: "cancelled" }),
        makeHeartbeatRun({ id: "q7", status: "timed_out" }),
      ],
    });

    const res = await GET(makeRequest());
    const body = await res.json();
    const statusById = Object.fromEntries(
      body.runs.map((r: { id: string; status: string }) => [r.id, r.status]),
    );
    expect(statusById["q1"]).toBe("queued");
    expect(statusById["q2"]).toBe("queued");
    expect(statusById["q3"]).toBe("running");
    expect(statusById["q4"]).toBe("completed");
    expect(statusById["q5"]).toBe("failed");
    expect(statusById["q6"]).toBe("cancelled");
    expect(statusById["q7"]).toBe("failed");
  });

  it("returns 503 with {error} when heartbeatRuns fails", async () => {
    mockHeartbeatRuns.mockResolvedValueOnce({ ok: false, error: "connection refused" });

    const res = await GET(makeRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(typeof body.error).toBe("string");
  });

  it("returns 503 when Paperclip env vars are missing", async () => {
    delete process.env.PAPERCLIP_API_URL;
    delete process.env.PAPERCLIP_BOARD_KEY;
    delete process.env.PAPERCLIP_COMPANY_ID;

    const res = await GET(makeRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — Hermes path
// ---------------------------------------------------------------------------

describe("GET /api/agent/runs — Hermes path (dataSource()=hermes)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDataSource.mockReturnValue("hermes");
    // Simulate an empty runs file.
    mockReadFile.mockResolvedValue("");
  });

  it("returns { runs } from the Hermes file path and does NOT call Paperclip", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("runs");
    expect(Array.isArray(body.runs)).toBe(true);
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });

  it("returns empty runs when the file does not exist", async () => {
    const err = Object.assign(new Error("not found"), { code: "ENOENT" });
    mockReadFile.mockRejectedValueOnce(err);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runs).toEqual([]);
  });
});
