import { describe, it, expect, vi } from "vitest";
import { makeBrokerTokenProvider, staticTokenProvider } from "../src/broker.js";

function brokerFetch(token: string, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => ({ token }) });
}

describe("makeBrokerTokenProvider", () => {
  it("requests a repo-scoped token with owner+repo query params", async () => {
    const fetchMock = brokerFetch("ghs_abc");
    const getToken = makeBrokerTokenProvider("http://gh-token-broker:9099", "Goldberry-Playground", {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const token = await getToken("odoocker-goldberrygrove");
    expect(token).toBe("ghs_abc");

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/token");
    expect(url.searchParams.get("owner")).toBe("Goldberry-Playground");
    expect(url.searchParams.get("repo")).toBe("odoocker-goldberrygrove");
  });

  it("caches per repo until the TTL elapses, then refetches", async () => {
    const fetchMock = brokerFetch("tok1");
    let clock = 1_000;
    const getToken = makeBrokerTokenProvider("http://b", "Org", {
      fetchImpl: fetchMock as unknown as typeof fetch,
      ttlMs: 1000,
      now: () => clock,
    });

    await getToken("repo");
    await getToken("repo"); // cached — no second fetch
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clock += 1001; // past TTL
    await getToken("repo");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps separate cache entries per repo", async () => {
    const fetchMock = brokerFetch("t");
    const getToken = makeBrokerTokenProvider("http://b", "Org", {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await getToken("repo-a");
    await getToken("repo-b");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends an Authorization: Bearer header when an apiKey is supplied (M3/GOL-666)", async () => {
    const fetchMock = brokerFetch("ghs_abc");
    const getToken = makeBrokerTokenProvider("http://b", "Org", {
      fetchImpl: fetchMock as unknown as typeof fetch,
      apiKey: "broker-secret",
    });
    await getToken("repo");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer broker-secret");
  });

  it("omits the Authorization header when no apiKey is set", async () => {
    const fetchMock = brokerFetch("ghs_abc");
    const getToken = makeBrokerTokenProvider("http://b", "Org", {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await getToken("repo");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("throws on a non-OK broker response (no token leaked in the message)", async () => {
    const fetchMock = brokerFetch("", false, 404);
    const getToken = makeBrokerTokenProvider("http://b", "Org", {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await expect(getToken("repo")).rejects.toThrow("token broker -> 404");
  });

  it("throws when the broker returns no token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const getToken = makeBrokerTokenProvider("http://b", "Org", {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await expect(getToken("repo")).rejects.toThrow("returned no token");
  });
});

describe("staticTokenProvider", () => {
  it("returns the same token for any repo", async () => {
    const getToken = staticTokenProvider("pat_123");
    expect(await getToken("a")).toBe("pat_123");
    expect(await getToken("b")).toBe("pat_123");
  });
});
