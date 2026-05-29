import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/cost/db", () => ({
  getPool: () => ({ query: queryMock }),
}));

import { GET } from "./route";

beforeEach(() => {
  queryMock.mockReset();
});

describe("/api/ingest/status", () => {
  it("returns the most recent vault-ingest task row", async () => {
    const row = {
      id: "t1",
      started_at: "2026-05-22T07:00:00Z",
      status: "ok",
      metadata: { skipped: 5 },
    };
    queryMock.mockResolvedValue({ rows: [row] });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(row);

    const call = queryMock.mock.calls[0][0];
    expect(call).toMatch(/vault-ingest/);
    expect(call).toMatch(/ORDER BY started_at DESC/);
    expect(call).toMatch(/LIMIT 1/);
  });

  it("returns null when no rows", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });
});
