import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the Paperclip client factory so the route never touches the network.
// ---------------------------------------------------------------------------

const { mockHeartbeatRun, mockCreatePaperclipClient } = vi.hoisted(() => {
  const mockHeartbeatRun = vi.fn();
  const mockCreatePaperclipClient = vi.fn(() => ({
    heartbeatRun: mockHeartbeatRun,
  }));
  return { mockHeartbeatRun, mockCreatePaperclipClient };
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
    error: null,
    createdAt: "2026-06-17T10:00:00Z",
    livenessState: null,
    livenessReason: null,
    contextSnapshot: null,
    resultJson: null,
    ...overrides,
  };
}

function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

const req = new Request("http://localhost/api/agent/runs/run-1");

// ---------------------------------------------------------------------------
// Tests — Paperclip path
// ---------------------------------------------------------------------------

describe("GET /api/agent/runs/[id] — Paperclip path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCreatePaperclipClient.mockReturnValue({ heartbeatRun: mockHeartbeatRun });
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

  it("maps a single HeartbeatRun to a RunRecord", async () => {
    mockHeartbeatRun.mockResolvedValueOnce({
      ok: true,
      data: makeHeartbeatRun({
        id: "run-42",
        status: "succeeded",
        finishedAt: "2026-06-17T10:05:00Z",
        resultJson: { costCents: 250 },
      }),
    });

    const res = await GET(req, makeCtx("run-42"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe("run-42");
    expect(body.agent).toBe("agent-1");
    expect(body.status).toBe("completed");
    expect(body.startedAt).toBe("2026-06-17T10:00:00Z");
    expect(body.endedAt).toBe("2026-06-17T10:05:00Z");
    // costCents 250 → costUsd 2.5
    expect(body.costUsd).toBeCloseTo(2.5);
    // Token fields are zeroed (Paperclip carries no per-call token counts).
    expect(body.inputTokens).toBe(0);
    expect(body.outputTokens).toBe(0);
    expect(body.cacheReadTokens).toBe(0);
    expect(body.cacheCreationTokens).toBe(0);
    expect(body.toolCalls).toBe(0);
    expect(body.errorMessage).toBeNull();

    // Client was constructed with the configured id and called with the run id.
    expect(mockHeartbeatRun).toHaveBeenCalledWith("run-42");
  });

  it("returns 404 when Paperclip reports the run is not found", async () => {
    mockHeartbeatRun.mockResolvedValueOnce({
      ok: false,
      error: "HTTP 404 Not Found: Heartbeat run not found",
    });

    const res = await GET(req, makeCtx("missing"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 503 with {error} for a non-404 Paperclip failure", async () => {
    mockHeartbeatRun.mockResolvedValueOnce({ ok: false, error: "connection refused" });

    const res = await GET(req, makeCtx("run-1"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 503 when Paperclip env vars are missing", async () => {
    delete process.env.PAPERCLIP_API_URL;
    delete process.env.PAPERCLIP_BOARD_KEY;
    delete process.env.PAPERCLIP_COMPANY_ID;

    const res = await GET(req, makeCtx("run-1"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — Hermes path (existing behaviour — must not regress)
// ---------------------------------------------------------------------------

// NOTE: The dashboard's vitest setup does not intercept `node:fs/promises`
// (the sibling list-route Hermes tests rely on the same real-fs fallthrough).
// These Hermes-path tests therefore exercise the dead runs file at its real
// default path, which is absent in CI → the route's missing-file branch is hit
// and a 404 is returned. That is exactly the post-Hermes-retirement behaviour
// this branch preserves: the file-read path is untouched, and the only
// supported live source is Paperclip (covered above).
describe("GET /api/agent/runs/[id] — Hermes path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDataSource.mockReturnValue("hermes");
  });

  it("does not touch Paperclip and returns 404 for the retired runs file", async () => {
    const res = await GET(req, makeCtx("run-7"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });
});
