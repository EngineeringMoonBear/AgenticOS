import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the Paperclip client factory so the route never touches the network.
// ---------------------------------------------------------------------------

const { mockCostSummary, mockCreatePaperclipClient } = vi.hoisted(() => {
  const mockCostSummary = vi.fn();
  const mockCreatePaperclipClient = vi.fn(() => ({
    costSummary: mockCostSummary,
  }));
  return { mockCostSummary, mockCreatePaperclipClient };
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
// Tests — Paperclip path
// ---------------------------------------------------------------------------

describe("GET /api/cost/today — Paperclip path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCreatePaperclipClient.mockReturnValue({ costSummary: mockCostSummary });
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

  it("maps three costSummary calls to CostTodayResponse shape", async () => {
    // Provide different values for the three calls: today, yesterday, MTD.
    mockCostSummary
      // today range
      .mockResolvedValueOnce({
        ok: true,
        data: {
          companyId: "co-test",
          spendCents: 450,
          budgetCents: 30000,
          utilizationPercent: 1.5,
        },
      })
      // yesterday range
      .mockResolvedValueOnce({
        ok: true,
        data: {
          companyId: "co-test",
          spendCents: 380,
          budgetCents: 30000,
          utilizationPercent: 1.27,
        },
      })
      // MTD range
      .mockResolvedValueOnce({
        ok: true,
        data: {
          companyId: "co-test",
          spendCents: 9200,
          budgetCents: 30000,
          utilizationPercent: 30.67,
        },
      });

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    // Must match the CostTodayResponse shape consumed by use-kpi-data.ts.
    expect(body).toHaveProperty("summary");
    expect(body.summary.today_cents).toBe(450);
    expect(body.summary.yesterday_cents).toBe(380);
    expect(body.summary.mtd_cents).toBe(9200);
    // cap_cents comes from budgetCents (same across all three calls in fixture).
    expect(body.summary.cap_cents).toBe(30000);

    // costSummary called exactly 3 times (today, yesterday, MTD).
    expect(mockCostSummary).toHaveBeenCalledTimes(3);
  });

  it("cap_cents is 0 when budgetCents is 0 (no budget configured)", async () => {
    mockCostSummary.mockResolvedValue({
      ok: true,
      data: {
        companyId: "co-test",
        spendCents: 100,
        budgetCents: 0,
        utilizationPercent: 0,
      },
    });

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.summary.cap_cents).toBe(0);
  });

  it("returns 503 with {error} when the today costSummary call fails", async () => {
    mockCostSummary
      .mockResolvedValueOnce({ ok: false, error: "HTTP 502 Bad Gateway" })
      .mockResolvedValue({
        ok: true,
        data: { companyId: "co-test", spendCents: 0, budgetCents: 0, utilizationPercent: 0 },
      });

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(typeof body.error).toBe("string");
  });

  it("returns 503 with {error} when the yesterday costSummary call fails", async () => {
    mockCostSummary
      .mockResolvedValueOnce({
        ok: true,
        data: { companyId: "co-test", spendCents: 100, budgetCents: 1000, utilizationPercent: 10 },
      })
      .mockResolvedValueOnce({ ok: false, error: "timeout" })
      .mockResolvedValue({
        ok: true,
        data: { companyId: "co-test", spendCents: 0, budgetCents: 0, utilizationPercent: 0 },
      });

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 503 with {error} when the MTD costSummary call fails", async () => {
    mockCostSummary
      .mockResolvedValueOnce({
        ok: true,
        data: { companyId: "co-test", spendCents: 100, budgetCents: 1000, utilizationPercent: 10 },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { companyId: "co-test", spendCents: 80, budgetCents: 1000, utilizationPercent: 8 },
      })
      .mockResolvedValueOnce({ ok: false, error: "connection reset" });

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toHaveProperty("error");
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

// ---------------------------------------------------------------------------
// Tests — Hermes path
// ---------------------------------------------------------------------------

describe("GET /api/cost/today — Hermes path (dataSource()=hermes)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDataSource.mockReturnValue("hermes");
  });

  afterEach(() => {
    delete process.env.DASHBOARD_DATA_SOURCE;
  });

  it("returns CostTodayResponse from Hermes and does NOT call the Paperclip client", async () => {
    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    // Must expose the shape consumed by use-kpi-data.ts.
    expect(body).toHaveProperty("summary");
    expect(typeof body.summary.today_cents).toBe("number");
    expect(typeof body.summary.yesterday_cents).toBe("number");
    expect(typeof body.summary.cap_cents).toBe("number");
    expect(typeof body.summary.mtd_cents).toBe("number");

    // Paperclip client must not be called.
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });
});
