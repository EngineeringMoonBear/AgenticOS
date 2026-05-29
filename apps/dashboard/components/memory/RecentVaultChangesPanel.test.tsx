import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { RecentVaultChangesPanel } from "./RecentVaultChangesPanel";

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("RecentVaultChangesPanel", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          source: "syncthing",
          checked_at: new Date().toISOString(),
          changes: [
            { path: "farming/pasture-management/rotation.md", kind: "updated", time_label: "13:45" },
            { path: "farming/soil-health/ph-zones.md", kind: "created", time_label: "11:20" },
            { path: "farming/forage/winter-stockpile.md", kind: "updated", time_label: "09:15" },
            { path: "dev/code-review-style.md", kind: "updated", time_label: "yesterday" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders vault changes with file paths and kind pills", async () => {
    renderWithClient(<RecentVaultChangesPanel />);
    await waitFor(() => {
      expect(screen.getByText("Recent vault changes")).toBeInTheDocument();
      expect(screen.getByText("farming/pasture-management/rotation.md")).toBeInTheDocument();
      expect(screen.getByText("farming/soil-health/ph-zones.md")).toBeInTheDocument();
      expect(screen.getByText("created")).toBeInTheDocument();
      expect(screen.getAllByText("updated").length).toBeGreaterThanOrEqual(3);
      expect(screen.getByText("13:45")).toBeInTheDocument();
      expect(screen.getByText("yesterday")).toBeInTheDocument();
    });
  });
});
