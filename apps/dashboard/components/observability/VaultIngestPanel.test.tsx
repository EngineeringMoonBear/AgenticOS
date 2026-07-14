import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { VaultIngestPanel } from "./VaultIngestPanel";

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("VaultIngestPanel", () => {
  let payload: unknown;

  beforeEach(() => {
    payload = {
      schedule: "0 * * * *",
      runs: [
        {
          id: "vault-ingest-5464de072e",
          started_at: "2026-07-14T15:00:00.000Z",
          ended_at: "2026-07-14T15:00:00.312Z",
          status: "done",
          error: null,
          metadata: null,
        },
        {
          id: "vault-ingest-4b4ec8a43d",
          started_at: "2026-07-14T14:08:00.000Z",
          ended_at: "2026-07-14T14:08:05.800Z",
          status: "failed",
          error: "viking timeout",
          metadata: null,
        },
        {
          id: "vault-ingest-0b3780feba",
          started_at: "2026-07-14T14:00:00.000Z",
          ended_at: null,
          status: "running",
          error: null,
          metadata: null,
        },
      ],
    };
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

  it("renders real task rows with status pills, durations, and cron schedule", async () => {
    renderWithClient(<VaultIngestPanel />);
    await waitFor(() => {
      expect(screen.getByText("Vault ingest")).toBeInTheDocument();
      expect(screen.getByText(/cron 0 \* \* \* \*/)).toBeInTheDocument();
      expect(screen.getByText("vault-ingest-5464de072e")).toBeInTheDocument();
      expect(screen.getByText("312ms")).toBeInTheDocument();
      expect(screen.getByText("failed")).toBeInTheDocument();
      expect(screen.getByText(/viking timeout/)).toBeInTheDocument();
      expect(screen.getByText("5.8s")).toBeInTheDocument();
      // Still-running row has no duration yet.
      expect(screen.getByText("running")).toBeInTheDocument();
      expect(screen.getByText("—")).toBeInTheDocument();
    });
  });

  it("renders empty state when no runs are recorded", async () => {
    payload = { schedule: "0 * * * *", runs: [] };
    renderWithClient(<VaultIngestPanel />);
    await waitFor(() => {
      expect(
        screen.getByText(/no vault-ingest runs recorded/i),
      ).toBeInTheDocument();
    });
  });
});
