import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { OpenVikingSummaryPanel } from "./OpenVikingSummaryPanel";

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("OpenVikingSummaryPanel", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          total: 1652,
          scopes: [
            { name: "resources", scope: "viking://resources", count: 1204, fill_percent: 73 },
            { name: "user/memories", scope: "viking://user/*", count: 312, fill_percent: 19 },
            { name: "session/*", scope: "viking://session", count: 89, fill_percent: 5 },
            { name: "agent/skills", scope: "viking://agent", count: 47, fill_percent: 3 },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders scope bar rows and total", async () => {
    renderWithClient(<OpenVikingSummaryPanel />);
    await waitFor(() => {
      expect(screen.getByText("OpenViking")).toBeInTheDocument();
      expect(screen.getByText("1,652 total")).toBeInTheDocument();
      expect(screen.getByText("resources")).toBeInTheDocument();
      expect(screen.getByText("viking://resources")).toBeInTheDocument();
      expect(screen.getByText("1,204")).toBeInTheDocument();
      expect(screen.getByText("agent/skills")).toBeInTheDocument();
    });
  });
});
