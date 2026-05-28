import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { OllamaPanel } from "./OllamaPanel";

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("OllamaPanel", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          endpoint: "localhost:11434",
          models: [
            { name: "nomic-embed-text", role: "embedding", size: "274 MB", age: "2m ago", calls_today: 8432 },
            { name: "qwen2.5:3b", role: "chat", size: "1.9 GB", age: "14m ago", calls_today: 312 },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders local model rows with call counts", async () => {
    renderWithClient(<OllamaPanel />);
    await waitFor(() => {
      expect(screen.getByText("Ollama · local")).toBeInTheDocument();
      expect(screen.getByText("nomic-embed-text")).toBeInTheDocument();
      expect(screen.getByText(/embedding · 274 MB · 2m ago/)).toBeInTheDocument();
      expect(screen.getByText("8,432")).toBeInTheDocument();
      expect(screen.getByText("qwen2.5:3b")).toBeInTheDocument();
      expect(screen.getByText("312")).toBeInTheDocument();
      expect(screen.getByText("localhost:11434")).toBeInTheDocument();
    });
  });
});
