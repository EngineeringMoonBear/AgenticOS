import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the Paperclip client factory so the route never touches the network.
// vi.mock is hoisted to the top of the file, so the factory cannot reference
// variables declared in this module. We use vi.hoisted() to lift the shared
// spies into the hoisted scope.
// ---------------------------------------------------------------------------

const { mockCostSummary, mockCostByAgentModel, mockCreatePaperclipClient } =
  vi.hoisted(() => {
    const mockCostSummary = vi.fn();
    const mockCostByAgentModel = vi.fn();
    const mockCreatePaperclipClient = vi.fn(() => ({
      costSummary: mockCostSummary,
      costByAgentModel: mockCostByAgentModel,
    }));
    return { mockCostSummary, mockCostByAgentModel, mockCreatePaperclipClient };
  });

vi.mock("@/lib/paperclip/client", () => ({
  createPaperclipClient: mockCreatePaperclipClient,
}));

// Import after mocks are registered.
import { GET } from "./route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/costs");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/costs", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Re-attach factory after resetAllMocks clears return values.
    mockCreatePaperclipClient.mockReturnValue({
      costSummary: mockCostSummary,
      costByAgentModel: mockCostByAgentModel,
    });
    // Provide env vars for the config-guard tests that need them.
    process.env.PAPERCLIP_API_URL = "https://paperclip.test";
    process.env.PAPERCLIP_BOARD_KEY = "test-board-key";
    process.env.PAPERCLIP_COMPANY_ID = "co-test";
  });

  it("composes costSummary + costByAgentModel into the dashboard shape", async () => {
    mockCostSummary.mockResolvedValue({
      ok: true,
      data: {
        companyId: "co-1",
        spendCents: 4618,
        budgetCents: 20000,
        utilizationPercent: 23.09,
      },
    });
    mockCostByAgentModel.mockResolvedValue({
      ok: true,
      data: [
        {
          agentId: "a1",
          agentName: "Daily Brief",
          provider: "anthropic",
          biller: null,
          billingType: null,
          model: "claude-3-5-sonnet-20241022",
          costCents: 3200,
          inputTokens: 100000,
          cachedInputTokens: 50000,
          outputTokens: 5000,
        },
        {
          agentId: "a2",
          agentName: "Inbox Triage",
          provider: "openai",
          biller: null,
          billingType: null,
          model: "gpt-4o",
          costCents: 1418,
          inputTokens: 20000,
          cachedInputTokens: 0,
          outputTokens: 3000,
        },
      ],
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    // Top-level spend/budget fields (cents).
    expect(body.totalCents).toBe(4618);
    expect(body.budgetCents).toBe(20000);

    // byModel strips agent-level detail, keeps provider+model+costCents.
    expect(body.byModel).toHaveLength(2);
    expect(body.byModel[0]).toMatchObject({
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
      costCents: 3200,
    });
    expect(body.byModel[1]).toMatchObject({
      provider: "openai",
      model: "gpt-4o",
      costCents: 1418,
    });
  });

  it("forwards from/to query params to both client methods", async () => {
    mockCostSummary.mockResolvedValue({
      ok: true,
      data: { companyId: "co-1", spendCents: 0, budgetCents: 0, utilizationPercent: 0 },
    });
    mockCostByAgentModel.mockResolvedValue({ ok: true, data: [] });

    await GET(makeRequest({ from: "2026-06-01", to: "2026-06-17" }));

    expect(mockCostSummary).toHaveBeenCalledWith({ from: "2026-06-01", to: "2026-06-17" });
    expect(mockCostByAgentModel).toHaveBeenCalledWith({ from: "2026-06-01", to: "2026-06-17" });
  });

  it("returns 503 with {error} when costSummary fails", async () => {
    mockCostSummary.mockResolvedValue({ ok: false, error: "HTTP 502 Bad Gateway" });
    mockCostByAgentModel.mockResolvedValue({ ok: true, data: [] });

    const res = await GET(makeRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(typeof body.error).toBe("string");
  });

  it("returns 503 with {error} when costByAgentModel fails", async () => {
    mockCostSummary.mockResolvedValue({
      ok: true,
      data: { companyId: "co-1", spendCents: 0, budgetCents: 0, utilizationPercent: 0 },
    });
    mockCostByAgentModel.mockResolvedValue({ ok: false, error: "timeout" });

    const res = await GET(makeRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 503 when env vars are missing", async () => {
    // Remove env vars to trigger the config guard.
    delete process.env.PAPERCLIP_API_URL;
    delete process.env.PAPERCLIP_BOARD_KEY;
    delete process.env.PAPERCLIP_COMPANY_ID;

    const res = await GET(makeRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    // Client factory must NOT have been called — no config available.
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });
});
