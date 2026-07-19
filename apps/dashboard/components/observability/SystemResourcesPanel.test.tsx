import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { SystemResourcesPanel } from "./SystemResourcesPanel";

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("SystemResourcesPanel", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({ available: false, reason: "metrics source not connected" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders honest placeholders while no metrics source is connected", async () => {
    renderWithClient(<SystemResourcesPanel />);
    await waitFor(() => {
      expect(screen.getByText("CPU")).toBeInTheDocument();
      expect(screen.getByText("RAM")).toBeInTheDocument();
      expect(screen.getByText("Disk")).toBeInTheDocument();
      expect(screen.getAllByText("—")).toHaveLength(3);
      expect(screen.getByText(/metrics source not connected/)).toBeInTheDocument();
      expect(
        screen.getByText(/awaiting OpenObserve wiring \(GOL-313\)/),
      ).toBeInTheDocument();
    });
  });
});
