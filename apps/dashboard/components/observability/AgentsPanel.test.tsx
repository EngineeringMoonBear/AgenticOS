import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { AgentsPanel } from "./AgentsPanel";

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

interface MockAgent {
  id: string;
  name: string;
  adapter: string | null;
  status: string;
  lastActivityAt: string | null;
}

describe("AgentsPanel", () => {
  let mockAgents: MockAgent[] = [];
  let fetchStatus = 200;

  beforeEach(() => {
    fetchStatus = 200;
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ agents: mockAgents }), {
        status: fetchStatus,
        headers: { "content-type": "application/json" },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the panel title", async () => {
    mockAgents = [];
    renderWithClient(<AgentsPanel />);
    await waitFor(() => {
      expect(screen.getByText("Agents")).toBeInTheDocument();
    });
  });

  it("shows empty state when no agents are returned", async () => {
    mockAgents = [];
    renderWithClient(<AgentsPanel />);
    await waitFor(() => {
      expect(screen.getByText(/no agents registered/i)).toBeInTheDocument();
    });
  });

  it("renders agent rows with name, adapter, status chip, and relative last-activity", async () => {
    // Use a fixed timestamp 5 minutes ago for deterministic relative output.
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    mockAgents = [
      {
        id: "agent-1",
        name: "Alice",
        adapter: "acpx_local",
        status: "active",
        lastActivityAt: fiveMinAgo,
      },
    ];

    renderWithClient(<AgentsPanel />);

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
      expect(screen.getByText("acpx_local")).toBeInTheDocument();
      // Status chip shows the status text.
      expect(screen.getByText("active")).toBeInTheDocument();
      // Relative time: somewhere between "4m ago" and "6m ago" is fine.
      expect(screen.getByText(/m ago/)).toBeInTheDocument();
    });
  });

  it("renders multiple agent rows", async () => {
    mockAgents = [
      {
        id: "agent-1",
        name: "Alice",
        adapter: "acpx_local",
        status: "active",
        lastActivityAt: new Date(Date.now() - 60_000).toISOString(),
      },
      {
        id: "agent-2",
        name: "Bob",
        adapter: "acpx_cloud",
        status: "paused",
        lastActivityAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
      },
    ];

    renderWithClient(<AgentsPanel />);

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
      expect(screen.getByText("Bob")).toBeInTheDocument();
      expect(screen.getByText("active")).toBeInTheDocument();
      expect(screen.getByText("paused")).toBeInTheDocument();
      expect(screen.getByText("acpx_local")).toBeInTheDocument();
      expect(screen.getByText("acpx_cloud")).toBeInTheDocument();
    });
  });

  it("shows '—' for last-activity when lastActivityAt is null", async () => {
    mockAgents = [
      {
        id: "agent-3",
        name: "Carol",
        adapter: "acpx_local",
        status: "active",
        lastActivityAt: null,
      },
    ];

    renderWithClient(<AgentsPanel />);

    await waitFor(() => {
      expect(screen.getByText("Carol")).toBeInTheDocument();
      expect(screen.getByText("—")).toBeInTheDocument();
    });
  });

  it("shows error state when the fetch fails", async () => {
    fetchStatus = 503;
    mockAgents = [];
    renderWithClient(<AgentsPanel />);

    await waitFor(() => {
      expect(screen.getByText(/failed to load agents/i)).toBeInTheDocument();
    });
  });

  it("shows agent count in the panel action area", async () => {
    mockAgents = [
      {
        id: "agent-1",
        name: "Alice",
        adapter: "acpx_local",
        status: "active",
        lastActivityAt: null,
      },
      {
        id: "agent-2",
        name: "Bob",
        adapter: "acpx_cloud",
        status: "active",
        lastActivityAt: null,
      },
    ];

    renderWithClient(<AgentsPanel />);

    await waitFor(() => {
      expect(screen.getByText("2 agents")).toBeInTheDocument();
    });
  });

  it("renders singular 'agent' for one agent", async () => {
    mockAgents = [
      {
        id: "agent-1",
        name: "Alice",
        adapter: "acpx_local",
        status: "active",
        lastActivityAt: null,
      },
    ];

    renderWithClient(<AgentsPanel />);

    await waitFor(() => {
      expect(screen.getByText("1 agent")).toBeInTheDocument();
    });
  });
});
