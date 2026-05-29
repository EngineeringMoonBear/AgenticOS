import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { RateLimitsPanel } from "./RateLimitsPanel";

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("RateLimitsPanel", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          provider: "openai",
          resets_label: "resets 14:42",
          lines: [
            { name: "Tokens / minute", used: 73420, cap: 100000, detail: "73,420 / 100,000", variant: "amber" },
            { name: "Requests / minute", used: 12, cap: 100, detail: "12 / 100", variant: "pine" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders rate limit progress bars", async () => {
    renderWithClient(<RateLimitsPanel />);
    await waitFor(() => {
      expect(screen.getByText("Rate limits")).toBeInTheDocument();
      expect(screen.getByText(/openai · resets 14:42/)).toBeInTheDocument();
      expect(screen.getByText("Tokens / minute")).toBeInTheDocument();
      expect(screen.getByText("73,420 / 100,000")).toBeInTheDocument();
      expect(screen.getByText("Requests / minute")).toBeInTheDocument();
      expect(screen.getByText("12 / 100")).toBeInTheDocument();
    });
  });
});
