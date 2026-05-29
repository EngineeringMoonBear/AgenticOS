import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { useMemoryDetail } from "./use-memory-detail";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

describe("useMemoryDetail", () => {
  const stub = {
    uri: "viking://resources/a",
    content: "body",
    offset: 0,
    limit: 100,
    total: 1,
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

  it("returns detail for a uri with paging", async () => {
    const { result } = renderHook(() => useMemoryDetail("viking://resources/a", 0, 100), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(stub);
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(call).toContain("offset=0");
    expect(call).toContain("limit=100");
  });

  it("does not fetch with empty uri", () => {
    const { result } = renderHook(() => useMemoryDetail(""), { wrapper: wrapper() });
    expect(result.current.isFetching).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
