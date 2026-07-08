import { describe, it, expect, vi } from "vitest";
import { SyncthingClient } from "./syncthing-client.js";

describe("SyncthingClient", () => {
  it("getEvents() returns parsed events when API responds OK", async () => {
    const events = [
      { id: 1, type: "ItemFinished", time: "2026-05-30T01:00:00Z", data: { folder: "vault", item: "a.md" } },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(events), { status: 200 })));

    const client = new SyncthingClient({ baseUrl: "http://st:8384", apiKey: "k" });
    const result = await client.getEvents();
    expect(result.available).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.type).toBe("ItemFinished");
  });

  it("getEvents() returns {available: false} when fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const client = new SyncthingClient({ baseUrl: "http://st:8384", apiKey: "k" });
    const result = await client.getEvents();
    expect(result.available).toBe(false);
    expect(result.events).toEqual([]);
  });

  it("getEvents() respects the since parameter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new SyncthingClient({ baseUrl: "http://st:8384", apiKey: "k" });
    await client.getEvents({ since: 42 });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://st:8384/rest/events?since=42&timeout=1&limit=100",
      expect.objectContaining({ headers: { "X-API-Key": "k" } }),
    );
  });

  it("getEvents() always bounds the request: since=0 default, timeout=1, limit, and an abort signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new SyncthingClient({ baseUrl: "http://st:8384", apiKey: "k" });
    await client.getEvents();
    // No bare /rest/events calls: they long-poll (up to 60s) and hung
    // /recent-changes in the 2026-07-08 incident.
    expect(fetchMock).toHaveBeenCalledWith(
      "http://st:8384/rest/events?since=0&timeout=1&limit=100",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("getEvents() degrades to {available: false} when the request aborts (hang/blackhole)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError")),
    );

    const client = new SyncthingClient({ baseUrl: "http://st:8384", apiKey: "k" });
    const result = await client.getEvents();
    expect(result.available).toBe(false);
    expect(result.events).toEqual([]);
  });
});
