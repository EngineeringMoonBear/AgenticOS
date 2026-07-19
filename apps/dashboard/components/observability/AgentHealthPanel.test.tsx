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
  services: {
    name: string;
    ok: boolean;
    latencyMs: number | null;
    detail: string;
  }[];
  paperclip: { runningAgents: number | null; stuck: boolean } | null;
  checked_at: string;
}

describe("AgentHealthPanel", () => {
  let payload: ServicePayload = { services: [], paperclip: null, checked_at: "" };

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

  it("renders probed service rows with measured latency", async () => {
    payload = {
      services: [
        { name: "Paperclip", ok: true, latencyMs: 42, detail: "2 agents running" },
        { name: "OpenViking", ok: true, latencyMs: 12, detail: "reachable" },
      ],
      paperclip: { runningAgents: 2, stuck: false },
      checked_at: new Date().toISOString(),
    };
    renderWithClient(<AgentHealthPanel />);
    await waitFor(() => {
      expect(screen.getByText("Paperclip")).toBeInTheDocument();
      expect(screen.getByText("OpenViking")).toBeInTheDocument();
      expect(screen.getByText("42ms")).toBeInTheDocument();
      expect(screen.getByText("2 agents running")).toBeInTheDocument();
      expect(screen.getByText("Agent health")).toBeInTheDocument();
    });
  });

  it('renders "—" latency for a service that could not be probed', async () => {
    payload = {
      services: [
        { name: "Paperclip", ok: false, latencyMs: null, detail: "unreachable" },
        { name: "OpenViking", ok: false, latencyMs: null, detail: "not configured" },
      ],
      paperclip: { runningAgents: null, stuck: false },
      checked_at: new Date().toISOString(),
    };
    renderWithClient(<AgentHealthPanel />);
    await waitFor(() => {
      expect(screen.getAllByText("—")).toHaveLength(2);
      expect(screen.getByText("unreachable")).toBeInTheDocument();
      expect(screen.getByText("not configured")).toBeInTheDocument();
    });
  });

  it("renders empty state when no services reported", async () => {
    payload = { services: [], paperclip: null, checked_at: new Date().toISOString() };
    renderWithClient(<AgentHealthPanel />);
    await waitFor(() => {
      expect(screen.getByText(/no services reporting/i)).toBeInTheDocument();
    });
  });
});
