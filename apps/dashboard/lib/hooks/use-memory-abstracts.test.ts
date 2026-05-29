import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { useMemoryAbstracts } from "./use-memory-abstracts";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

describe("useMemoryAbstracts", () => {
  const stub = {
    items: [{ uri: "viking://resources/a", name: "a", abstract: "summary" }],
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

  it("returns abstracts for a uri", async () => {
    const { result } = renderHook(() => useMemoryAbstracts("viking://resources"), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(stub);
  });

  it("does not fetch with empty uri", () => {
    const { result } = renderHook(() => useMemoryAbstracts(""), { wrapper: wrapper() });
    expect(result.current.isFetching).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
