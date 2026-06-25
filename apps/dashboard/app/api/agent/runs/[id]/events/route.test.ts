import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the Paperclip client factory.
// ---------------------------------------------------------------------------

const { mockHeartbeatRunEvents, mockCreatePaperclipClient } = vi.hoisted(() => {
  const mockHeartbeatRunEvents = vi.fn();
  const mockCreatePaperclipClient = vi.fn(() => ({
    heartbeatRunEvents: mockHeartbeatRunEvents,
  }));
  return { mockHeartbeatRunEvents, mockCreatePaperclipClient };
});

vi.mock("@/lib/paperclip/client", () => ({
  createPaperclipClient: mockCreatePaperclipClient,
}));

const { mockDataSource } = vi.hoisted(() => {
  const mockDataSource = vi.fn(() => "paperclip" as "hermes" | "paperclip");
  return { mockDataSource };
});

vi.mock("@/lib/config/data-source", () => ({
  dataSource: mockDataSource,
}));

import { GET } from "./route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    companyId: "co-1",
    runId: "run-1",
    agentId: "agent-1",
    seq: 1,
    eventType: "lifecycle",
    stream: null,
    level: "info",
    color: null,
    message: "started",
    payload: { foo: "bar" },
    createdAt: "2026-06-17T10:00:00Z",
    ...overrides,
  };
}

function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

const req = new Request("http://localhost/api/agent/runs/run-1/events");

/** Parse an SSE body into the array of decoded `data:` JSON payloads. */
function parseSse(text: string): unknown[] {
  return text
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => JSON.parse(block.replace(/^data:\s*/, "")));
}

// ---------------------------------------------------------------------------
// Tests — Paperclip path
// ---------------------------------------------------------------------------

describe("GET /api/agent/runs/[id]/events — Paperclip path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCreatePaperclipClient.mockReturnValue({
      heartbeatRunEvents: mockHeartbeatRunEvents,
    });
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

  it("maps Paperclip events to {ts, kind, payload} SSE messages", async () => {
    mockHeartbeatRunEvents.mockResolvedValueOnce({
      ok: true,
      data: [
        makeEvent({
          seq: 1,
          eventType: "lifecycle",
          createdAt: "2026-06-17T10:00:00Z",
          payload: { phase: "start" },
        }),
        makeEvent({
          seq: 2,
          eventType: "stdout",
          createdAt: "2026-06-17T10:00:01Z",
          payload: { line: "hello" },
        }),
      ],
    });

    const res = await GET(req, makeCtx("run-1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    const events = parseSse(await res.text());
    expect(events).toEqual([
      { ts: "2026-06-17T10:00:00Z", kind: "lifecycle", payload: { phase: "start" } },
      { ts: "2026-06-17T10:00:01Z", kind: "stdout", payload: { line: "hello" } },
    ]);
    expect(mockHeartbeatRunEvents).toHaveBeenCalledWith("run-1");
  });

  it("preserves a null payload without fabricating a value", async () => {
    mockHeartbeatRunEvents.mockResolvedValueOnce({
      ok: true,
      data: [makeEvent({ payload: null })],
    });

    const res = await GET(req, makeCtx("run-1"));
    const events = parseSse(await res.text());
    expect(events).toEqual([
      { ts: "2026-06-17T10:00:00Z", kind: "lifecycle", payload: null },
    ]);
  });

  it("returns an empty SSE stream when there are no events", async () => {
    mockHeartbeatRunEvents.mockResolvedValueOnce({ ok: true, data: [] });

    const res = await GET(req, makeCtx("run-1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect((await res.text()).trim()).toBe("");
  });

  it("returns 404 when Paperclip reports the run is not found", async () => {
    mockHeartbeatRunEvents.mockResolvedValueOnce({
      ok: false,
      error: "HTTP 404 Not Found: Heartbeat run not found",
    });

    const res = await GET(req, makeCtx("missing"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 503 with {error} for a non-404 Paperclip failure", async () => {
    mockHeartbeatRunEvents.mockResolvedValueOnce({ ok: false, error: "timeout" });

    const res = await GET(req, makeCtx("run-1"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 503 when Paperclip env vars are missing", async () => {
    delete process.env.PAPERCLIP_API_URL;

    const res = await GET(req, makeCtx("run-1"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — Hermes path (no per-run event stream existed)
// ---------------------------------------------------------------------------

describe("GET /api/agent/runs/[id]/events — Hermes path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDataSource.mockReturnValue("hermes");
  });

  it("returns an empty SSE stream and never calls Paperclip", async () => {
    const res = await GET(req, makeCtx("run-1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect((await res.text()).trim()).toBe("");
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });
});
