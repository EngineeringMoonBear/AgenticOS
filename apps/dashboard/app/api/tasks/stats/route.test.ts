import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/cost/db", () => ({
  getPool: () => ({ query: queryMock }),
}));

import { GET } from "./route";

beforeEach(() => {
  queryMock.mockReset();
});

describe("/api/tasks/stats", () => {
  it("coerces SQL text/numeric/array results into a typed RunsStats payload", async () => {
    queryMock.mockResolvedValue({
      rows: [
        {
          active_count: "3",
          failed_today: "2",
          avg_duration_sec: "107.4",
          active_kinds: ["curator", "daily-brief", "vault-ingest"],
        },
      ],
    });

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      activeCount: 3,
      failedToday: 2,
      avgDurationSec: 107.4,
      activeKinds: ["curator", "daily-brief", "vault-ingest"],
    });
  });

  it("returns null avg duration when SQL gives null (no completed runs in 24h)", async () => {
    queryMock.mockResolvedValue({
      rows: [
        {
          active_count: "0",
          failed_today: "0",
          avg_duration_sec: null,
          active_kinds: null,
        },
      ],
    });

    const res = await GET();
    const body = await res.json();
    expect(body.activeCount).toBe(0);
    expect(body.failedToday).toBe(0);
    expect(body.avgDurationSec).toBeNull();
    expect(body.activeKinds).toEqual([]);
  });

  it("survives an empty rowset without throwing", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      activeCount: 0,
      failedToday: 0,
      avgDurationSec: null,
      activeKinds: [],
    });
  });
});
