import { describe, expect, it, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { useKpiData } from "./use-kpi-data";

/** Build a fetch stub keyed by URL substring → Response-like object. */
function stubFetch(
  routes: Record<string, { ok: boolean; json: unknown }>,
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const match = Object.keys(routes).find((k) => url.includes(k));
    if (!match) throw new Error(`unstubbed fetch: ${url}`);
    const { ok, json } = routes[match];
    return {
      ok,
      status: ok ? 200 : 502,
      json: async () => json,
    } as Response;
  }) as unknown as typeof fetch;
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createElement(QueryClientProvider, { client: qc }, children);
}

const HEALTHY = {
  "/api/cost/today": {
    ok: true,
    json: {
      summary: {
        today_cents: 241,
        yesterday_cents: 294,
        cap_cents: 20000,
        mtd_cents: 4618,
      },
    },
  },
  "/api/tasks/queue-depth": {
    ok: true,
    json: {
      rows: [
        { kind: "curator", status: "running", count: 2 },
        { kind: "daily-brief", status: "queued", count: 1 },
      ],
      asOf1hCount: 2,
    },
  },
  "/api/vault/stats": { ok: true, json: { pageCount: 2847 } },
  "/api/viking/scopes": {
    ok: true,
    json: { reachable: true, total: 1204, scopes: { resources: 800, session: 404 } },
  },
};

afterEach(() => vi.restoreAllMocks());

describe("useKpiData", () => {
  it("assembles all four tiles from real responses", async () => {
    vi.stubGlobal("fetch", stubFetch(HEALTHY));
    const { result } = renderHook(() => useKpiData(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());

    const d = result.current.data!;
    expect(d.todaySpend).toEqual({
      cents: 241,
      deltaPct: -18, // (241-294)/294 = -18%
      capCents: 20000,
      mtdCents: 4618,
    });
    expect(d.activeRuns).toEqual({
      count: 3, // 2 + 1
      delta: 1, // 3 now − 2 an hour ago
      kinds: ["curator", "daily-brief"],
    });
    expect(d.vaultFiles).toEqual({ count: 2847 });
    expect(d.memoriesIndexed).toEqual({
      count: 1204,
      categories: ["resources", "session"], // sorted by count desc
    });
  });

  it("degrades tiles independently — a failed source yields null, others survive", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({
        ...HEALTHY,
        "/api/viking/scopes": { ok: false, json: {} }, // Viking down
        "/api/vault/stats": { ok: true, json: { pageCount: 100 } },
      }),
    );
    const { result } = renderHook(() => useKpiData(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());

    const d = result.current.data!;
    expect(d.memoriesIndexed).toBeNull(); // failed source → null
    expect(d.vaultFiles).toEqual({ count: 100 }); // others intact
    expect(d.todaySpend).not.toBeNull();
    expect(d.activeRuns).not.toBeNull();
  });

  it("omits the spend delta when yesterday had no spend (avoids divide-by-zero)", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({
        ...HEALTHY,
        "/api/cost/today": {
          ok: true,
          json: {
            summary: { today_cents: 500, yesterday_cents: 0, cap_cents: 20000, mtd_cents: 500 },
          },
        },
      }),
    );
    const { result } = renderHook(() => useKpiData(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.todaySpend!.deltaPct).toBeNull();
  });

  it("reports reachable-but-empty Viking as a real zero, not a failure", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({
        ...HEALTHY,
        "/api/viking/scopes": { ok: true, json: { reachable: true, total: 0, scopes: {} } },
      }),
    );
    const { result } = renderHook(() => useKpiData(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.memoriesIndexed).toEqual({ count: 0, categories: [] });
  });
});
