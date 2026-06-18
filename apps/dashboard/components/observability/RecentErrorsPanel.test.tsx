import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { RecentErrorsPanel } from "./RecentErrorsPanel";

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("RecentErrorsPanel", () => {
  let mockRows: Array<{
    id: string;
    kind: string;
    error: string | null;
    started_at: string;
  }> = [];
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ error: "not implemented" }), {
          status: 501,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ rows: mockRows }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.spyOn(global, "fetch").mockImplementation(fetchSpy as typeof fetch);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows empty state when no failed tasks", async () => {
    mockRows = [];
    renderWithClient(<RecentErrorsPanel />);
    await waitFor(() => {
      expect(screen.getByText(/no failed tasks/i)).toBeInTheDocument();
    });
  });

  it("renders an error row with id, kind, and message", async () => {
    mockRows = [
      {
        id: "5464de072e1f",
        kind: "vault-ingest",
        error: "Cannot remove URI: 404",
        started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
    ];
    renderWithClient(<RecentErrorsPanel />);
    await waitFor(() => {
      expect(screen.getByText("5464de072e")).toBeInTheDocument();
      expect(screen.getByText("vault-ingest")).toBeInTheDocument();
      expect(screen.getByText(/cannot remove uri/i)).toBeInTheDocument();
    });
  });

  it("POSTs to the retry endpoint when retry button is clicked", async () => {
    mockRows = [
      {
        id: "abc123def4",
        kind: "curator",
        error: "boom",
        started_at: new Date().toISOString(),
      },
    ];
    renderWithClient(<RecentErrorsPanel />);
    const btn = await screen.findByRole("button", { name: /retry curator/i });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/tasks/abc123def4/retry",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("shows retry button by default (hermes path)", async () => {
    mockRows = [
      {
        id: "abc123def4",
        kind: "curator",
        error: "boom",
        started_at: new Date().toISOString(),
      },
    ];
    renderWithClient(<RecentErrorsPanel />);
    const btn = await screen.findByRole("button", { name: /retry curator/i });
    expect(btn).toBeInTheDocument();
  });

  it("hides retry button when showRetryButton=false (paperclip path)", async () => {
    mockRows = [
      {
        id: "abc123def4",
        kind: "timer",
        error: null,
        started_at: new Date().toISOString(),
      },
    ];
    renderWithClient(<RecentErrorsPanel showRetryButton={false} />);
    // Wait for row to appear
    await waitFor(() => {
      expect(screen.getByText("timer")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /retry timer/i })).toBeNull();
  });
});
