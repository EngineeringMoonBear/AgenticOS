import { describe, it, expect, vi } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/cost/db", () => ({
  getCostSummary: vi.fn().mockResolvedValue({
    today_cents: 42,
    mtd_cents: 600,
    cap_cents: 3000,
    soft_alert_cents: 2400,
    pct_of_cap: 20,
    projected_month_end_cents: 1800,
  }),
  getTodayTasks: vi.fn().mockResolvedValue([
    {
      task_id: "t1",
      kind: "inbox-triage",
      status: "done",
      started_at: "2026-05-22T07:00:00Z",
      cost_cents: 0,
    },
  ]),
  getMonthByDay: vi.fn().mockResolvedValue([
    { day: "2026-05-22", cost_cents: 600 },
  ]),
  getMonthByKind: vi.fn().mockResolvedValue([
    { kind: "daily-brief", cost_cents: 600 },
  ]),
}));

describe("/api/cost/[scope]", () => {
  async function call(scope: string) {
    const req = new Request(`http://localhost/api/cost/${scope}`);
    return GET(req, { params: Promise.resolve({ scope }) });
  }

  it("today returns summary + today's tasks", async () => {
    const res = await call("today");
    const body = await res.json();
    expect(body.summary.today_cents).toBe(42);
    expect(body.tasks).toHaveLength(1);
  });

  it("month returns by-day + by-kind", async () => {
    const res = await call("month");
    const body = await res.json();
    expect(body.by_day).toHaveLength(1);
    expect(body.by_kind).toHaveLength(1);
  });

  it("forecast returns projection", async () => {
    const res = await call("forecast");
    const body = await res.json();
    expect(body.projected_month_end_cents).toBe(1800);
  });

  it("unknown scope returns 404", async () => {
    const res = await call("bogus");
    expect(res.status).toBe(404);
  });
});
