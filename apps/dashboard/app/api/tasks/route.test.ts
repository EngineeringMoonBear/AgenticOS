import { describe, it, expect, vi } from "vitest";
import { GET, POST } from "./route";

vi.mock("@/lib/agent/hermes-client", () => ({
  getHermesClient: () => ({
    listTasks: vi.fn().mockResolvedValue([
      {
        id: "t1",
        kind: "inbox-triage",
        status: "done",
        started_at: "2026-05-22T07:00:00Z",
        ended_at: null,
        cost_cents: 0,
        trigger: "fsnotify",
        error: null,
        metadata: {},
      },
    ]),
    createTask: vi.fn().mockResolvedValue({
      id: "t2",
      kind: "manual",
      status: "queued",
      started_at: "2026-05-22T08:00:00Z",
      ended_at: null,
      cost_cents: 0,
      trigger: "manual",
      error: null,
      metadata: {},
    }),
  }),
}));

describe("/api/tasks", () => {
  it("GET returns task list as JSON", async () => {
    const req = new Request("http://localhost/api/tasks");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].id).toBe("t1");
  });

  it("POST creates a task", async () => {
    const req = new Request("http://localhost/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "manual", prompt: "hi" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("t2");
  });

  it("POST returns 400 when kind/prompt missing", async () => {
    const req = new Request("http://localhost/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
