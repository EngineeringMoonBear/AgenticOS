import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/cost/db", () => ({
  getPool: () => ({ query: queryMock }),
}));

import { GET } from "./route";

beforeEach(() => {
  queryMock.mockReset();
});

describe("/api/tasks/recent-events", () => {
  it("returns rows mapped to the chart's event contract", async () => {
    queryMock.mockResolvedValue({
      rows: [
        {
          id: "t1",
          kind: "curator",
          status: "running",
          at: "2026-05-29T12:00:00Z",
        },
        {
          id: "t2",
          kind: "daily-brief",
          status: "done",
          at: "2026-05-29T11:55:00Z",
        },
      ],
    });

    const res = await GET(new Request("http://localhost/api/tasks/recent-events"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.windowMin).toBe(60);
    expect(body.events).toEqual([
      { at: "2026-05-29T12:00:00Z", status: "running", kind: "curator", id: "t1" },
      { at: "2026-05-29T11:55:00Z", status: "done", kind: "daily-brief", id: "t2" },
    ]);
  });

  it("honors a custom windowMin within the 24h ceiling", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const res = await GET(
      new Request("http://localhost/api/tasks/recent-events?windowMin=180"),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).windowMin).toBe(180);
    expect(queryMock.mock.calls[0][1]).toEqual([180]);
  });

  it("clamps windowMin to the 24h ceiling", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const res = await GET(
      new Request("http://localhost/api/tasks/recent-events?windowMin=99999"),
    );
    expect((await res.json()).windowMin).toBe(24 * 60);
    expect(queryMock.mock.calls[0][1]).toEqual([24 * 60]);
  });

  it("falls back to the 60-min default for invalid windowMin", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const res = await GET(
      new Request("http://localhost/api/tasks/recent-events?windowMin=abc"),
    );
    expect((await res.json()).windowMin).toBe(60);
  });

  it("uses started_at for running tasks and ended_at for terminal ones (SQL inspection)", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await GET(new Request("http://localhost/api/tasks/recent-events"));
    const sql = queryMock.mock.calls[0][0] as string;
    expect(sql).toMatch(/WHEN status = 'running' THEN started_at/);
    expect(sql).toMatch(/ELSE ended_at/);
    expect(sql).toMatch(/status IN \('done', 'failed'\)/);
  });
});
