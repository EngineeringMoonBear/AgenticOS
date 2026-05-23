import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenVikingClient } from "./openviking-client";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenVikingClient", () => {
  it("requires baseUrl + apiKey", () => {
    expect(() => new OpenVikingClient("", "k")).toThrow(/baseUrl/);
    expect(() => new OpenVikingClient("http://ov", "")).toThrow(/apiKey/);
  });

  it("posts to /api/v1/search/find with Bearer auth + JSON body", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ id: "m1", text: "winter forage planning", score: 0.91 }],
      }),
    });

    const client = new OpenVikingClient("http://ov:1933", "ovk_test123");
    const results = await client.search({ query: "winter forage", top_k: 5 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://ov:1933/api/v1/search/find");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer ovk_test123",
    });
    expect(JSON.parse(init.body)).toEqual({ query: "winter forage", top_k: 5 });
    expect(results).toEqual([
      { id: "m1", text: "winter forage planning", score: 0.91 },
    ]);
  });

  it("defaults top_k to 10 when omitted", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    });
    const client = new OpenVikingClient("http://ov:1933", "k");
    await client.search({ query: "anything" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.top_k).toBe(10);
  });

  it("throws on non-OK response with status code in message", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });
    const client = new OpenVikingClient("http://ov:1933", "bad-key");
    await expect(client.search({ query: "x" })).rejects.toThrow(/401/);
  });

  it("returns empty array when server omits the results key", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const client = new OpenVikingClient("http://ov:1933", "k");
    const r = await client.search({ query: "x" });
    expect(r).toEqual([]);
  });
});
