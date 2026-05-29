import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { useMemoryOverview } from "./use-memory-overview";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

describe("useMemoryOverview", () => {
  const stub = { uri: "viking://resources/a", overview: "the overview" };

  beforeEach(() => {
    vi.spyOn(global, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify(stub), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns overview for a uri", async () => {
    const { result } = renderHook(() => useMemoryOverview("viking://resources/a"), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(stub);
  });

  it("does not fetch with empty uri", () => {
    const { result } = renderHook(() => useMemoryOverview(""), { wrapper: wrapper() });
    expect(result.current.isFetching).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
