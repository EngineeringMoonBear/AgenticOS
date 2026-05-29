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
            { name: "gpt-5-codex", role: "reasoning", calls: 12, age: "6m ago", spend_usd: 1.84 },
            { name: "gpt-4o-mini", role: "orchestration", calls: 247, age: "28s ago", spend_usd: 0.57 },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders model usage rows with cost", async () => {
    renderWithClient(<OpenAICodexPanel />);
    await waitFor(() => {
      expect(screen.getByText("OpenAI Codex · cloud")).toBeInTheDocument();
      expect(screen.getByText("gpt-5-codex")).toBeInTheDocument();
      expect(screen.getByText(/reasoning · 12 calls · 6m ago/)).toBeInTheDocument();
      expect(screen.getByText("$1.84")).toBeInTheDocument();
      expect(screen.getByText("gpt-4o-mini")).toBeInTheDocument();
      expect(screen.getByText("$0.57")).toBeInTheDocument();
      expect(screen.getByText("api.openai.com")).toBeInTheDocument();
    });
  });
});
