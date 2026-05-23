import { describe, it, expect, vi, beforeEach } from "vitest";
import { HermesClient } from "./hermes-client";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("HermesClient", () => {
  it("listTasks GETs /api/tasks", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: "t1", kind: "inbox-triage", status: "done" }],
    });
    const c = new HermesClient("http://hermes:7777");
    const tasks = await c.listTasks();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://hermes:7777/api/tasks",
      expect.objectContaining({ method: "GET" }),
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("t1");
  });

  it("createTask POSTs body", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "t2", kind: "manual", status: "queued" }),
    });
    const c = new HermesClient("http://hermes:7777");
    const t = await c.createTask({ kind: "manual", prompt: "hello" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://hermes:7777/api/tasks",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
    expect(t.id).toBe("t2");
  });

  it("throws on non-OK response", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: async () => "down",
    });
    const c = new HermesClient("http://hermes:7777");
    await expect(c.listTasks()).rejects.toThrow(/502/);
  });
});
