import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, afterEach } from "vitest";
import { OpenVikingSummaryPanel } from "./OpenVikingSummaryPanel";

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

function mockFetch(routes: Record<string, unknown>) {
  vi.spyOn(global, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    const key = Object.keys(routes).find((k) => url.includes(k));
    return new Response(JSON.stringify(key ? routes[key] : {}), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

describe("OpenVikingSummaryPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders scope bar rows and total when reachable", async () => {
    mockFetch({
      "/api/viking/health": { reachable: true, uptimeSec: 1200 },
      "/api/viking/scopes": {
        reachable: true,
        total: 1516,
        scopes: { resources: 1204, "user/memories": 312 },
      },
    });

    renderWithClient(<OpenVikingSummaryPanel />);
    await waitFor(() => {
      expect(screen.getByText("OpenViking")).toBeInTheDocument();
      expect(screen.getByText("1,516 total")).toBeInTheDocument();
      expect(screen.getByText("resources")).toBeInTheDocument();
      expect(screen.getByText("1,204")).toBeInTheDocument();
      expect(screen.getByText("user/memories")).toBeInTheDocument();
    });
  });

  it("renders an unreachable state when Viking is down", async () => {
    mockFetch({
      "/api/viking/health": { reachable: false },
      "/api/viking/scopes": { reachable: false, total: 0, scopes: {} },
    });

    renderWithClient(<OpenVikingSummaryPanel />);
    await waitFor(() => {
      expect(screen.getByText("OpenViking unreachable.")).toBeInTheDocument();
      expect(screen.getByText("offline")).toBeInTheDocument();
    });
  });

  it("renders honest zeros when reachable but empty", async () => {
    mockFetch({
      "/api/viking/health": { reachable: true },
      "/api/viking/scopes": { reachable: true, total: 0, scopes: {} },
    });

    renderWithClient(<OpenVikingSummaryPanel />);
    await waitFor(() => {
      expect(screen.getByText("0 total")).toBeInTheDocument();
      expect(screen.getByText("No memories indexed yet.")).toBeInTheDocument();
    });
  });
});
