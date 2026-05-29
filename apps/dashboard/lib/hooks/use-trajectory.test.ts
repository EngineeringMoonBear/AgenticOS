import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { useTrajectory } from "./use-trajectory";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

describe("useTrajectory", () => {
  const stub = {
    nodes: [{ id: "viking://x", kind: "uri" as const, label: "x", size: 1 }],
    links: [],
  };

  beforeEach(() => {
    vi.spyOn(global, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify(stub), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns trajectory graph", async () => {
    const { result } = renderHook(() => useTrajectory("viking://resources/a"), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(stub);
  });

  it("does not fetch with empty uri", () => {
    const { result } = renderHook(() => useTrajectory(""), { wrapper: wrapper() });
    expect(result.current.isFetching).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
