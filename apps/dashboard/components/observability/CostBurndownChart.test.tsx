import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CostBurndownChart } from "./CostBurndownChart";

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("CostBurndownChart", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    fetchSpy.mockImplementation(async (url: string) => {
      const u = new URL(url, "http://localhost");
      const range = u.searchParams.get("range") ?? "24h";
      return new Response(
        JSON.stringify({ range, bucket: range === "30d" ? "day" : "hour", points: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.spyOn(global, "fetch").mockImplementation(fetchSpy as typeof fetch);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders empty state without crashing when there are no points", async () => {
    renderWithClient(<CostBurndownChart />);
    await waitFor(() => {
      expect(screen.getByText(/no spend recorded/i)).toBeInTheDocument();
    });
  });

  it("switches the fetch URL when the range toggle is changed", async () => {
    renderWithClient(<CostBurndownChart />);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("range=24h"));
    });

    fireEvent.click(screen.getByRole("tab", { name: "30d" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("range=30d"));
    });
  });
});
