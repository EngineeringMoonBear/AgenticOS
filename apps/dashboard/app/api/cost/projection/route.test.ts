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
  const mockDataSource = vi.fn(() => "hermes" as "hermes" | "paperclip");
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

describe("GET /api/cost/projection — Paperclip path", () => {
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

  it("maps Paperclip costSummary to CostProjectionData shape", async () => {
    // MTD summary — spendCents is month-to-date spend.
    mockCostSummary.mockResolvedValue({
      ok: true,
      data: {
        companyId: "co-test",
        spendCents: 4618,
        budgetCents: 20000,
        utilizationPercent: 23.09,
      },
    });

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    // Required shape fields.
    expect(typeof body.spend_usd).toBe("number");
    expect(typeof body.cap_usd).toBe("number");
    expect(typeof body.mtd_spend_usd).toBe("number");
    expect(typeof body.avg_per_day_usd).toBe("number");
    expect(typeof body.days_remaining).toBe("number");

    // spend_usd and mtd_spend_usd both derived from spendCents (4618 cents = $46.18).
    expect(body.spend_usd).toBeCloseTo(46.18, 1);
    expect(body.mtd_spend_usd).toBeCloseTo(46.18, 1);

    // cap_usd derived from budgetCents (20000 cents = $200).
    expect(body.cap_usd).toBeCloseTo(200, 1);
  });

  it("derives cap_usd from budgetCents; cap is 0 when budgetCents is 0", async () => {
    mockCostSummary.mockResolvedValue({
      ok: true,
      data: {
        companyId: "co-test",
        spendCents: 500,
        budgetCents: 0,
        utilizationPercent: 0,
      },
    });

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    // No budget → cap_usd is 0 (not fabricated).
    expect(body.cap_usd).toBe(0);
  });

  it("computes avg_per_day_usd and days_remaining based on MTD spend and days elapsed", async () => {
    mockCostSummary.mockResolvedValue({
      ok: true,
      data: {
        companyId: "co-test",
        spendCents: 3000,
        budgetCents: 50000,
        utilizationPercent: 6,
      },
    });

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    // avg_per_day_usd must be a non-negative number.
    expect(body.avg_per_day_usd).toBeGreaterThanOrEqual(0);
    // days_remaining must be a non-negative integer.
    expect(body.days_remaining).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(body.days_remaining)).toBe(true);
  });

  it("returns 503 with {error} when costSummary fails", async () => {
    mockCostSummary.mockResolvedValue({ ok: false, error: "HTTP 503 upstream" });

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

// ---------------------------------------------------------------------------
// Tests — Hermes path (existing stub, unchanged)
// ---------------------------------------------------------------------------

describe("GET /api/cost/projection — Hermes path (dataSource()=hermes)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDataSource.mockReturnValue("hermes");
  });

  afterEach(() => {
    delete process.env.DASHBOARD_DATA_SOURCE;
  });

  it("returns the hardcoded Hermes stub and does NOT call the Paperclip client", async () => {
    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    // The Hermes stub returns the fixed placeholder values.
    expect(typeof body.spend_usd).toBe("number");
    expect(typeof body.cap_usd).toBe("number");
    expect(typeof body.mtd_spend_usd).toBe("number");
    expect(typeof body.avg_per_day_usd).toBe("number");
    expect(typeof body.days_remaining).toBe("number");

    // Paperclip client must not be called.
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });
});
