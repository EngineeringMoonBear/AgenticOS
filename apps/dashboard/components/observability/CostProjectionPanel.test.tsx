import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CostProjectionPanel } from "./CostProjectionPanel";

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("CostProjectionPanel", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          spend_usd: 47.74,
          cap_usd: 200,
          mtd_spend_usd: 46.18,
          avg_per_day_usd: 1.54,
          days_remaining: 3,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders projected spend, cap, pill, and detail rows", async () => {
    renderWithClient(<CostProjectionPanel />);
    await waitFor(() => {
      expect(screen.getByText("Cost projection")).toBeInTheDocument();
      expect(screen.getByText(/\$47\.74/)).toBeInTheDocument();
      expect(screen.getByText(/\/ \$200/)).toBeInTheDocument();
      expect(screen.getByText(/24% of cap/)).toBeInTheDocument();
      expect(screen.getByText("MTD spend")).toBeInTheDocument();
      expect(screen.getByText("$46.18")).toBeInTheDocument();
      expect(screen.getByText("7-day avg / day")).toBeInTheDocument();
      expect(screen.getByText("$1.54")).toBeInTheDocument();
      expect(screen.getByText("Days remaining")).toBeInTheDocument();
    });
  });

  it("renders spend without cap/percentage when cap_usd is 0", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          spend_usd: 12.34,
          cap_usd: 0,
          mtd_spend_usd: 11.00,
          avg_per_day_usd: 0.50,
          days_remaining: 10,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    renderWithClient(<CostProjectionPanel />);
    await waitFor(() => {
      expect(screen.getByText(/\$12\.34/)).toBeInTheDocument();
      // No "% of cap" pill or Infinity text should be rendered
      expect(screen.queryByText(/of cap/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/infinity/i)).not.toBeInTheDocument();
      // Detail rows still present
      expect(screen.getByText("MTD spend")).toBeInTheDocument();
      expect(screen.getByText("$11.00")).toBeInTheDocument();
      expect(screen.getByText("Days remaining")).toBeInTheDocument();
    });
  });
});
