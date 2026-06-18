import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the Paperclip client factory (vi.hoisted so factory is available at
// vi.mock() call time).
// ---------------------------------------------------------------------------

const { mockAgents, mockCreatePaperclipClient } = vi.hoisted(() => {
  const mockAgents = vi.fn();
  const mockCreatePaperclipClient = vi.fn(() => ({
    agents: mockAgents,
  }));
  return { mockAgents, mockCreatePaperclipClient };
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

// Import after mocks are registered.
import { GET } from "./route";
import type { AgentRow } from "./route";

// ---------------------------------------------------------------------------
// Fixture helper
// ---------------------------------------------------------------------------

function makeAgent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    companyId: "11111111-1111-1111-1111-111111111111",
    name: "Alice",
    role: "ic",
    title: "Senior Engineer",
    status: "active",
    adapterType: "acpx_local",
    budgetMonthlyCents: 100000,
    spentMonthlyCents: 11540,
    lastHeartbeatAt: "2025-06-17T08:12:34.000Z",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-06-17T08:12:34.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — non-paperclip path
// ---------------------------------------------------------------------------

describe("GET /api/agents — non-paperclip path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDataSource.mockReturnValue("hermes");
  });

  it("returns an empty agents list without calling Paperclip", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agents: AgentRow[] };
    expect(body.agents).toEqual([]);
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — Paperclip path
// ---------------------------------------------------------------------------

describe("GET /api/agents — Paperclip path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDataSource.mockReturnValue("paperclip");
    mockCreatePaperclipClient.mockReturnValue({ agents: mockAgents });
    process.env.PAPERCLIP_API_URL = "https://paperclip.test";
    process.env.PAPERCLIP_BOARD_KEY = "test-board-key";
    process.env.PAPERCLIP_COMPANY_ID = "co-test";
  });

  afterEach(() => {
    delete process.env.PAPERCLIP_API_URL;
    delete process.env.PAPERCLIP_BOARD_KEY;
    delete process.env.PAPERCLIP_COMPANY_ID;
  });

  it("maps Agent[] to AgentRow[] with correct field mapping", async () => {
    mockAgents.mockResolvedValue({
      ok: true,
      data: [
        makeAgent({
          id: "agent-1",
          name: "Alice",
          adapterType: "acpx_local",
          status: "active",
          lastHeartbeatAt: "2025-06-17T08:12:34.000Z",
        }),
        makeAgent({
          id: "agent-2",
          name: "Bob",
          adapterType: "acpx_cloud",
          status: "paused",
          lastHeartbeatAt: "2025-06-17T09:00:01.000Z",
        }),
      ],
    });

    const res = await GET();
    expect(res.status).toBe(200);

    const body = (await res.json()) as { agents: AgentRow[] };
    expect(body.agents).toHaveLength(2);

    expect(body.agents[0]).toMatchObject({
      id: "agent-1",
      name: "Alice",
      adapter: "acpx_local",
      status: "active",
      lastActivityAt: "2025-06-17T08:12:34.000Z",
    });

    expect(body.agents[1]).toMatchObject({
      id: "agent-2",
      name: "Bob",
      adapter: "acpx_cloud",
      status: "paused",
      lastActivityAt: "2025-06-17T09:00:01.000Z",
    });
  });

  it("sets lastActivityAt to null when lastHeartbeatAt is absent", async () => {
    // Agent without lastHeartbeatAt (e.g. never heartbeated)
    const agentNoHeartbeat = makeAgent({ lastHeartbeatAt: undefined });
    delete (agentNoHeartbeat as Record<string, unknown>)["lastHeartbeatAt"];

    mockAgents.mockResolvedValue({ ok: true, data: [agentNoHeartbeat] });

    const res = await GET();
    const body = (await res.json()) as { agents: AgentRow[] };
    expect(body.agents[0].lastActivityAt).toBeNull();
  });

  it("sets lastActivityAt to null when lastHeartbeatAt is null", async () => {
    mockAgents.mockResolvedValue({
      ok: true,
      data: [makeAgent({ lastHeartbeatAt: null })],
    });

    const res = await GET();
    const body = (await res.json()) as { agents: AgentRow[] };
    expect(body.agents[0].lastActivityAt).toBeNull();
  });

  it("returns 503 with {error} when agents() fails", async () => {
    mockAgents.mockResolvedValue({ ok: false, error: "HTTP 502 Bad Gateway" });

    const res = await GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body).toHaveProperty("error");
    expect(typeof body.error).toBe("string");
  });

  it("returns 503 when env vars are missing", async () => {
    delete process.env.PAPERCLIP_API_URL;
    delete process.env.PAPERCLIP_BOARD_KEY;
    delete process.env.PAPERCLIP_COMPANY_ID;

    const res = await GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body).toHaveProperty("error");
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });

  it("maps adapterType to adapter (null adapterType becomes null adapter)", async () => {
    mockAgents.mockResolvedValue({
      ok: true,
      data: [makeAgent({ adapterType: null })],
    });

    const res = await GET();
    const body = (await res.json()) as { agents: AgentRow[] };
    expect(body.agents[0].adapter).toBeNull();
  });
});
