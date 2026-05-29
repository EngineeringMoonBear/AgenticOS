import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { useIngestStatus } from "./use-ingest-status";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

describe("useIngestStatus", () => {
  const stub = {
    id: "abc",
    started_at: "2026-05-29T00:00:00Z",
    status: "running",
    metadata: { foo: "bar" },
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

  it("returns ingest status row", async () => {
    const { result } = renderHook(() => useIngestStatus(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(stub);
  });
});
