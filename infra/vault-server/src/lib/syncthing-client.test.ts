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
      "http://st:8384/rest/events?since=42",
      expect.objectContaining({ headers: { "X-API-Key": "k" } }),
    );
  });
});
