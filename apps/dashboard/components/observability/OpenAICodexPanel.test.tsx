import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { OpenAICodexPanel } from "./OpenAICodexPanel";

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("OpenAICodexPanel", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          endpoint: "api.openai.com",
          models: [
            {
              name: "gpt-4o",
              spend_usd: 8.0,
              inputTokens: 16000,
              cachedInputTokens: 3000,
              outputTokens: 4500,
            },
            {
              name: "gpt-4o-mini",
              spend_usd: 1.2,
              inputTokens: 24000,
              cachedInputTokens: 0,
              outputTokens: 6000,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders model usage rows with cost and token counts", async () => {
    renderWithClient(<OpenAICodexPanel />);
    await waitFor(() => {
      // Header
      expect(screen.getByText("OpenAI Codex · cloud")).toBeInTheDocument();
      expect(screen.getByText("api.openai.com")).toBeInTheDocument();

      // Model names
      expect(screen.getByText("gpt-4o")).toBeInTheDocument();
      expect(screen.getByText("gpt-4o-mini")).toBeInTheDocument();

      // Spend values
      expect(screen.getByText("$8.00")).toBeInTheDocument();
      expect(screen.getByText("$1.20")).toBeInTheDocument();

      // Token summary lines rendered (at least one "in · N out" line present)
      expect(screen.getAllByText(/in · [\d,]+ out/).length).toBeGreaterThan(0);
    });
  });

  it("does NOT render role, calls, or age fields", async () => {
    renderWithClient(<OpenAICodexPanel />);
    await waitFor(() => {
      expect(screen.getByText("gpt-4o")).toBeInTheDocument();
    });
    // The old stub fields must not appear anywhere
    expect(screen.queryByText(/calls/)).toBeNull();
    expect(screen.queryByText(/reasoning/)).toBeNull();
    expect(screen.queryByText(/orchestration/)).toBeNull();
    expect(screen.queryByText(/ago/)).toBeNull();
  });
});
