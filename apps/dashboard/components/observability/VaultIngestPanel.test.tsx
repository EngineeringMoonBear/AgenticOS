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
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          schedule: "hourly · next 16:00",
          runs: [
            { id: "vault-ingest-5464de072e", time_label: "15:00", detail: "skipped 5", status: "ok", duration_label: "312ms" },
            { id: "vault-ingest-4b4ec8a43d", time_label: "14:08", detail: "errored 2", status: "err", duration_label: "354ms" },
            { id: "vault-ingest-0b3780feba", time_label: "14:00", detail: "updated 1", status: "ok", duration_label: "5.8s" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders ingest runs with status pills and timestamps", async () => {
    renderWithClient(<VaultIngestPanel />);
    await waitFor(() => {
      expect(screen.getByText("Vault ingest")).toBeInTheDocument();
      expect(screen.getByText(/hourly · next 16:00/)).toBeInTheDocument();
      expect(screen.getByText(/15:00 · skipped 5/)).toBeInTheDocument();
      expect(screen.getByText("vault-ingest-5464de072e")).toBeInTheDocument();
      expect(screen.getByText("312ms")).toBeInTheDocument();
      expect(screen.getByText(/14:08 · errored 2/)).toBeInTheDocument();
      expect(screen.getByText("failed")).toBeInTheDocument();
      expect(screen.getByText("5.8s")).toBeInTheDocument();
    });
  });
});
