import { describe, it, expect, vi, afterEach } from "vitest";
import { DiscordClient } from "../src/discord-client.js";

const BASE = "https://discord.test/api/v10";

function client() {
  return new DiscordClient({ token: "tok", baseUrl: BASE, timeoutMs: 1000 });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("DiscordClient", () => {
  it("fetches messages after a cursor, returns ascending order, sends Bot auth", async () => {
    // Discord returns newest-first; client must reverse to ascending.
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          id: "3",
          channel_id: "c",
          author: { id: "u", username: "j" },
          content: "",
          timestamp: "t",
          attachments: [],
        },
        {
          id: "2",
          channel_id: "c",
          author: { id: "u", username: "j" },
          content: "",
          timestamp: "t",
          attachments: [],
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await client().fetchMessagesAfter("c", "1");
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/channels/c/messages?limit=50&after=1`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bot tok" }),
      }),
    );
    expect(res).toEqual({
      ok: true,
      data: [
        expect.objectContaining({ id: "2" }),
        expect.objectContaining({ id: "3" }),
      ],
    });
  });

  it("omits after param when cursor is null", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    await client().fetchMessagesAfter("c", null);
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/channels/c/messages?limit=50`,
      expect.anything(),
    );
  });

  it("replies with message_reference", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "9" }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await client().replyToMessage("c", "m1", "hello");
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init.body)).toEqual({
      content: "hello",
      message_reference: { message_id: "m1" },
    });
    expect(res.ok).toBe(true);
  });

  it("retries once on 429 honoring retry_after", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ retry_after: 0.01 }, 429))
      .mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    const res = await client().fetchMessagesAfter("c", null);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.ok).toBe(true);
  });

  it("dmUser opens a DM channel then posts to it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "dm-chan" }))
      .mockResolvedValueOnce(jsonResponse({ id: "msg-1" }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await client().dmUser("user-1", "digest text");
    expect(fetchMock.mock.calls[0]![0]).toBe(`${BASE}/users/@me/channels`);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      recipient_id: "user-1",
    });
    expect(fetchMock.mock.calls[1]![0]).toBe(`${BASE}/channels/dm-chan/messages`);
    expect(res.ok).toBe(true);
  });

  it("returns error result on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ message: "Missing Access" }, 403)),
    );
    const res = await client().fetchMessagesAfter("c", null);
    expect(res).toEqual({ ok: false, error: "Missing Access" });
  });

  it("downloadAttachment returns bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(bytes)));
    const res = await client().downloadAttachment("https://cdn.test/x.jpg");
    expect(res.ok).toBe(true);
    if (res.ok) expect([...res.data]).toEqual([1, 2, 3]);
  });
});
