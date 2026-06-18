import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the Paperclip client factory so the route never touches the network.
// ---------------------------------------------------------------------------

const { mockCostByAgentModel, mockCreatePaperclipClient } = vi.hoisted(() => {
  const mockCostByAgentModel = vi.fn();
  const mockCreatePaperclipClient = vi.fn(() => ({
    costByAgentModel: mockCostByAgentModel,
  }));
  return { mockCostByAgentModel, mockCreatePaperclipClient };
});

vi.mock("@/lib/paperclip/client", () => ({
  createPaperclipClient: mockCreatePaperclipClient,
}));

// Mock the data-source flag.
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
// Helpers
// ---------------------------------------------------------------------------

/** Multi-agent fixture with two openai models across agents, plus one anthropic row. */
const MIXED_ROWS = [
  {
    agentId: "agent-1",
    agentName: "Alice",
    provider: "openai",
    biller: "openai",
    billingType: "metered_api",
    model: "gpt-4o",
    costCents: 500,
    inputTokens: 10000,
    cachedInputTokens: 2000,
    outputTokens: 3000,
  },
  {
    agentId: "agent-2",
    agentName: "Bob",
    provider: "openai",
    biller: "openai",
    billingType: "metered_api",
    model: "gpt-4o",
    costCents: 300,
    inputTokens: 6000,
    cachedInputTokens: 1000,
    outputTokens: 1500,
  },
  {
    agentId: "agent-1",
    agentName: "Alice",
    provider: "openai",
    biller: "openai",
    billingType: "metered_api",
    model: "gpt-4o-mini",
    costCents: 120,
    inputTokens: 24000,
    cachedInputTokens: 0,
    outputTokens: 6000,
  },
  {
    agentId: "agent-1",
    agentName: "Alice",
    provider: "anthropic",
    biller: "anthropic",
    billingType: "metered_api",
    model: "claude-opus-4-5",
    costCents: 8200,
    inputTokens: 410000,
    cachedInputTokens: 82000,
    outputTokens: 24600,
  },
];

// ---------------------------------------------------------------------------
// Tests — Paperclip path
// ---------------------------------------------------------------------------

describe("GET /api/cost/models/openai — Paperclip path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCreatePaperclipClient.mockReturnValue({ costByAgentModel: mockCostByAgentModel });
    mockDataSource.mockReturnValue("paperclip");
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

  it("filters to openai provider and aggregates by model", async () => {
    mockCostByAgentModel.mockResolvedValueOnce({ ok: true, data: MIXED_ROWS });

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("endpoint");
    expect(body).toHaveProperty("models");

    // Only openai rows, anthropic filtered out
    const models: { name: string; spend_usd: number; inputTokens: number; cachedInputTokens: number; outputTokens: number }[] =
      body.models;
    expect(models).toHaveLength(2);

    // gpt-4o: agent-1 + agent-2 aggregated
    const gpt4o = models.find((m) => m.name === "gpt-4o");
    expect(gpt4o).toBeDefined();
    expect(gpt4o!.spend_usd).toBeCloseTo((500 + 300) / 100); // 8.00
    expect(gpt4o!.inputTokens).toBe(10000 + 6000);
    expect(gpt4o!.cachedInputTokens).toBe(2000 + 1000);
    expect(gpt4o!.outputTokens).toBe(3000 + 1500);

    // gpt-4o-mini: single row
    const mini = models.find((m) => m.name === "gpt-4o-mini");
    expect(mini).toBeDefined();
    expect(mini!.spend_usd).toBeCloseTo(120 / 100); // 1.20
    expect(mini!.inputTokens).toBe(24000);
    expect(mini!.cachedInputTokens).toBe(0);
    expect(mini!.outputTokens).toBe(6000);

    // No calls / role / age fields in the new shape
    expect(gpt4o).not.toHaveProperty("calls");
    expect(gpt4o).not.toHaveProperty("role");
    expect(gpt4o).not.toHaveProperty("age");
  });

  it("returns empty models array when no openai rows exist", async () => {
    const anthropicOnly = MIXED_ROWS.filter((r) => r.provider === "anthropic");
    mockCostByAgentModel.mockResolvedValueOnce({ ok: true, data: anthropicOnly });

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.models).toHaveLength(0);
  });

  it("returns 503 with {error} when costByAgentModel fails", async () => {
    mockCostByAgentModel.mockResolvedValueOnce({ ok: false, error: "HTTP 502 Bad Gateway" });

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

  it("returns models sorted by spend_usd descending", async () => {
    mockCostByAgentModel.mockResolvedValueOnce({ ok: true, data: MIXED_ROWS });

    const res = await GET();
    const body = await res.json();
    const models: { spend_usd: number }[] = body.models;
    // gpt-4o (8.00) should come before gpt-4o-mini (1.20)
    expect(models[0].spend_usd).toBeGreaterThan(models[1].spend_usd);
  });
});

// ---------------------------------------------------------------------------
// Tests — Hermes path
// ---------------------------------------------------------------------------

describe("GET /api/cost/models/openai — Hermes path (dataSource()=hermes)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDataSource.mockReturnValue("hermes");
  });

  afterEach(() => {
    delete process.env.DASHBOARD_DATA_SOURCE;
  });

  it("returns OpenAICodexData from Hermes and does NOT call the Paperclip client", async () => {
    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("endpoint");
    expect(body).toHaveProperty("models");
    expect(Array.isArray(body.models)).toBe(true);

    // Hermes stub rows must conform to the new shape (no role/age/calls)
    for (const m of body.models) {
      expect(m).toHaveProperty("name");
      expect(m).toHaveProperty("spend_usd");
      expect(m).toHaveProperty("inputTokens");
      expect(m).toHaveProperty("outputTokens");
      expect(m).toHaveProperty("cachedInputTokens");
      expect(m).not.toHaveProperty("role");
      expect(m).not.toHaveProperty("age");
      expect(m).not.toHaveProperty("calls");
    }

    // Paperclip client must not be called.
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });
});
