import { describe, it, expect, vi } from "vitest";
import { GET, PUT } from "./route";

vi.mock("@/lib/cost/db", () => ({
  getBudget: vi.fn().mockResolvedValue({
    monthly_cap_cents: 3000,
    soft_alert_pct: 80,
    reset_day_of_month: 1,
  }),
  updateBudget: vi
    .fn()
    .mockImplementation(
      async (b: {
        monthly_cap_cents?: number;
        soft_alert_pct?: number;
        reset_day_of_month?: number;
      }) => ({
        monthly_cap_cents: b.monthly_cap_cents ?? 3000,
        soft_alert_pct: b.soft_alert_pct ?? 80,
        reset_day_of_month: b.reset_day_of_month ?? 1,
      }),
    ),
}));

describe("/api/budget", () => {
  it("GET returns current budget", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.monthly_cap_cents).toBe(3000);
    expect(body.soft_alert_pct).toBe(80);
  });

  it("PUT updates cap", async () => {
    const req = new Request("http://localhost/api/budget", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthly_cap_cents: 5000 }),
    });
    const res = await PUT(req);
    const body = await res.json();
    expect(body.monthly_cap_cents).toBe(5000);
  });

  it("PUT rejects negative cap", async () => {
    const req = new Request("http://localhost/api/budget", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthly_cap_cents: -1 }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });
});
