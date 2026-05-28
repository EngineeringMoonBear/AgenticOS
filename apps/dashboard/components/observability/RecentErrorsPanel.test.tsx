import { render, screen, waitFor } from "@testing-library/react";
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

  beforeEach(() => {
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ rows: mockRows }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
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

  it("renders an error row with kind and message", async () => {
    mockRows = [
      {
        id: "task_abc123",
        kind: "ingest",
        error: "boom",
        started_at: "2026-05-28T12:00:00Z",
      },
    ];
    renderWithClient(<RecentErrorsPanel />);
    await waitFor(() => {
      expect(screen.getByText("task_abc123")).toBeInTheDocument();
      expect(screen.getByText("ingest")).toBeInTheDocument();
      expect(screen.getByText("boom")).toBeInTheDocument();
    });
  });
});
