import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { QueueDepthPanel } from "./QueueDepthPanel";

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("QueueDepthPanel", () => {
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

  let mockRows: Array<{ kind: string; status: string; count: number }> = [];

  it("shows empty state when there are no rows", async () => {
    mockRows = [];
    renderWithClient(<QueueDepthPanel />);
    await waitFor(() => {
      expect(screen.getByText(/no queued or running tasks/i)).toBeInTheDocument();
    });
  });

  it("renders a row with its count", async () => {
    mockRows = [{ kind: "ingest", status: "running", count: 3 }];
    renderWithClient(<QueueDepthPanel />);
    await waitFor(() => {
      expect(screen.getByText(/ingest/i)).toBeInTheDocument();
      expect(screen.getByText("3")).toBeInTheDocument();
    });
  });
});
