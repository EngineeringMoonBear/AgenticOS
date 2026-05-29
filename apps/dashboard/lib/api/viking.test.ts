/**
 * Tests for the Viking read-shim used by the Memory tab API routes.
 *
 * These verify, for every exported helper:
 *  - URL + query encoding
 *  - the three required tenant headers (Authorization, X-OpenViking-Account,
 *    X-OpenViking-User)
 *  - cache: "no-store" on every request
 *  - useful error messages on non-2xx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENDPOINT = "http://viking.test:1933";
const API_KEY = "ovk_unit_test";
const ACCOUNT = "acct-x";
const USER = "user-x";

const fetchMock = vi.fn();

beforeEach(() => {
  process.env.OPENVIKING_ENDPOINT = ENDPOINT;
  process.env.OPENVIKING_API_KEY = API_KEY;
  process.env.OPENVIKING_ACCOUNT = ACCOUNT;
  process.env.OPENVIKING_USER = USER;
  vi.resetModules();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function errJson(status: number, body = "boom") {
  return {
    ok: false,
    status,
    json: async () => ({ error: body }),
    text: async () => body,
  };
}

function expectStdHeaders(init: RequestInit) {
  expect(init.cache).toBe("no-store");
  const h = init.headers as Record<string, string>;
  expect(h["Authorization"]).toBe(`Bearer ${API_KEY}`);
  expect(h["X-OpenViking-Account"]).toBe(ACCOUNT);
  expect(h["X-OpenViking-User"]).toBe(USER);
}

async function importShim() {
  return await import("./viking");
}

describe("vikingFsTree", () => {
  it("GETs /api/v1/fs/tree with uri query and tenant headers", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ name: "root", children: [] }));
    const { vikingFsTree } = await importShim();

    const out = await vikingFsTree("viking://memory/notes");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `${ENDPOINT}/api/v1/fs/tree?uri=${encodeURIComponent("viking://memory/notes")}`,
    );
    expect((init as RequestInit).method ?? "GET").toBe("GET");
    expectStdHeaders(init as RequestInit);
    expect(out).toEqual({ name: "root", children: [] });
  });

  it("throws with status + path on non-2xx", async () => {
    fetchMock.mockResolvedValueOnce(errJson(503, "down"));
    const { vikingFsTree } = await importShim();
    await expect(vikingFsTree("viking://x")).rejects.toThrow(/503/);
  });
});

describe("vikingFsLs", () => {
  it("GETs /api/v1/fs/ls with uri + simple=true", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ entries: [] }));
    const { vikingFsLs } = await importShim();
    await vikingFsLs("viking://m/path with space");
    const [url, init] = fetchMock.mock.calls[0];
    const u = new URL(url as string);
    expect(u.pathname).toBe("/api/v1/fs/ls");
    expect(u.searchParams.get("uri")).toBe("viking://m/path with space");
    expect(u.searchParams.get("simple")).toBe("true");
    expectStdHeaders(init as RequestInit);
  });
});

describe("vikingAbstract", () => {
  it("GETs /api/v1/content/abstract?uri=", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ abstract: "..." }));
    const { vikingAbstract } = await importShim();
    await vikingAbstract("viking://m/a");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `${ENDPOINT}/api/v1/content/abstract?uri=${encodeURIComponent("viking://m/a")}`,
    );
    expectStdHeaders(init as RequestInit);
  });
});

describe("vikingOverview", () => {
  it("GETs /api/v1/content/overview?uri=", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ overview: "..." }));
    const { vikingOverview } = await importShim();
    await vikingOverview("viking://m/a");
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `${ENDPOINT}/api/v1/content/overview?uri=${encodeURIComponent("viking://m/a")}`,
    );
  });
});

describe("vikingDetail", () => {
  it("defaults offset=0 and limit=8192 when omitted", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ content: "hi" }));
    const { vikingDetail } = await importShim();
    await vikingDetail("viking://m/a");
    const [url] = fetchMock.mock.calls[0];
    const u = new URL(url as string);
    expect(u.pathname).toBe("/api/v1/content/read");
    expect(u.searchParams.get("uri")).toBe("viking://m/a");
    expect(u.searchParams.get("offset")).toBe("0");
    expect(u.searchParams.get("limit")).toBe("8192");
  });

  it("passes through explicit offset + limit", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ content: "hi" }));
    const { vikingDetail } = await importShim();
    await vikingDetail("viking://m/a", 100, 50);
    const [url] = fetchMock.mock.calls[0];
    const u = new URL(url as string);
    expect(u.searchParams.get("offset")).toBe("100");
    expect(u.searchParams.get("limit")).toBe("50");
  });
});

describe("vikingRetrieval", () => {
  it("GETs /api/v1/observer/retrieval with no query", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ events: [] }));
    const { vikingRetrieval } = await importShim();
    await vikingRetrieval();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${ENDPOINT}/api/v1/observer/retrieval`);
    expectStdHeaders(init as RequestInit);
  });
});

describe("vikingBuildGraph", () => {
  it("POSTs /api/v1/relations/build_graph with JSON body", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ nodes: [], edges: [] }));
    const { vikingBuildGraph } = await importShim();
    await vikingBuildGraph("viking://m", "2026-05-01T00:00:00Z");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${ENDPOINT}/api/v1/relations/build_graph`);
    const r = init as RequestInit;
    expect(r.method).toBe("POST");
    const h = r.headers as Record<string, string>;
    expect(h["Content-Type"]).toBe("application/json");
    expectStdHeaders(r);
    const body = JSON.parse(r.body as string);
    expect(body.root_uri).toBe("viking://m");
    expect(body.since).toBe("2026-05-01T00:00:00Z");
  });
});

describe("vikingSearchFind", () => {
  it("POSTs query without target_uri when omitted", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ results: [] }));
    const { vikingSearchFind } = await importShim();
    await vikingSearchFind("hello");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${ENDPOINT}/api/v1/search/find`);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ query: "hello" });
    expect("target_uri" in body).toBe(false);
  });

  it("includes target_uri when provided", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ results: [] }));
    const { vikingSearchFind } = await importShim();
    await vikingSearchFind("hello", "viking://m");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ query: "hello", target_uri: "viking://m" });
  });
});

describe("vikingStatsMemories", () => {
  it("GETs without category param when omitted", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ total: 0 }));
    const { vikingStatsMemories } = await importShim();
    await vikingStatsMemories();
    const [url] = fetchMock.mock.calls[0];
    const u = new URL(url as string);
    expect(u.pathname).toBe("/api/v1/stats/memories");
    expect(u.searchParams.get("category")).toBeNull();
  });

  it("includes category when provided", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ total: 0 }));
    const { vikingStatsMemories } = await importShim();
    await vikingStatsMemories("notes");
    const u = new URL(fetchMock.mock.calls[0][0]);
    expect(u.searchParams.get("category")).toBe("notes");
  });
});

describe("vikingDashboardSummary", () => {
  it("GETs /api/v1/console/dashboard/summary with timezone query", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ ok: true }));
    const { vikingDashboardSummary } = await importShim();
    await vikingDashboardSummary("America/New_York");
    const [url, init] = fetchMock.mock.calls[0];
    const u = new URL(url as string);
    expect(u.pathname).toBe("/api/v1/console/dashboard/summary");
    expect(u.searchParams.get("timezone")).toBe("America/New_York");
    expectStdHeaders(init as RequestInit);
  });

  it("throws with body snippet on 500", async () => {
    fetchMock.mockResolvedValueOnce(errJson(500, "exploded"));
    const { vikingDashboardSummary } = await importShim();
    await expect(vikingDashboardSummary("UTC")).rejects.toThrow(
      /500.*exploded/,
    );
  });
});
