import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { LiveRunsPanel } from "./LiveRunsPanel";

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

interface MockRun {
  id: string;
  kind: string;
  started_at: string;
  elapsed_seconds: number;
  stuck: boolean;
}

describe("LiveRunsPanel", () => {
  let mockRuns: MockRun[] = [];

  beforeEach(() => {
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ runs: mockRuns }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows empty state when there are no active runs", async () => {
    mockRuns = [];
    renderWithClient(<LiveRunsPanel />);
    await waitFor(() => {
      expect(screen.getByText(/no tasks currently running/i)).toBeInTheDocument();
    });
  });

  it("renders a running row with kind and elapsed time", async () => {
    mockRuns = [
      {
        id: "cur-9a4e2b1d",
        kind: "curator",
        started_at: "2026-05-28T14:52:00Z",
        elapsed_seconds: 221,
        stuck: false,
      },
    ];
    renderWithClient(<LiveRunsPanel />);
    await waitFor(() => {
      expect(screen.getByText("curator")).toBeInTheDocument();
      expect(screen.getByText(/3m 41s/)).toBeInTheDocument();
      expect(screen.getByText(/running/i)).toBeInTheDocument();
    });
  });

  it("flags stuck runs with the stuck pill and alert cancel button", async () => {
    mockRuns = [
      {
        id: "vi-5464de07",
        kind: "vault-ingest",
        started_at: "2026-05-28T14:42:00Z",
        elapsed_seconds: 863,
        stuck: true,
      },
    ];
    renderWithClient(<LiveRunsPanel />);
    await waitFor(() => {
      expect(screen.getByText("vault-ingest")).toBeInTheDocument();
      expect(screen.getByText("stuck")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /force cancel stuck run/i }),
      ).toBeInTheDocument();
    });
  });
});
