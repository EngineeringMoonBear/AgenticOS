import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { AgentHealthPanel } from "./AgentHealthPanel";

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

interface ServicePayload {
  services: { name: string; latency_ms: number; ok: boolean }[];
  checked_at: string;
}

describe("AgentHealthPanel", () => {
  let payload: ServicePayload = { services: [], checked_at: "" };

  beforeEach(() => {
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders service rows with latency", async () => {
    payload = {
      services: [
        { name: "Hermes Gateway", latency_ms: 2, ok: true },
        { name: "OpenViking", latency_ms: 4, ok: true },
        { name: "Ollama", latency_ms: 12, ok: true },
        { name: "Postgres", latency_ms: 1, ok: true },
      ],
      checked_at: new Date().toISOString(),
    };
    renderWithClient(<AgentHealthPanel />);
    await waitFor(() => {
      expect(screen.getByText("Hermes Gateway")).toBeInTheDocument();
      expect(screen.getByText("OpenViking")).toBeInTheDocument();
      expect(screen.getByText("12ms")).toBeInTheDocument();
      expect(screen.getByText("Agent health")).toBeInTheDocument();
    });
  });

  it("renders empty state when no services reported", async () => {
    payload = { services: [], checked_at: new Date().toISOString() };
    renderWithClient(<AgentHealthPanel />);
    await waitFor(() => {
      expect(screen.getByText(/no services reporting/i)).toBeInTheDocument();
    });
  });
});
