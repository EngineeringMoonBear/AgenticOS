import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ScheduledRunsPanel } from "./ScheduledRunsPanel";

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("ScheduledRunsPanel", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/tasks/scheduled")) {
        return new Response(
          JSON.stringify({
            jobs: [
              { name: "vault-ingest", cron: "0 * * * *", last_run_label: "last 15:00 ok", next_in: "in 4m" },
              { name: "cost-report", cron: "0 23 * * *", last_run_label: "last 23:00 ok", next_in: "in 8h 4m" },
              { name: "daily-brief", cron: "0 7 * * *", last_run_label: "last 07:00 ok", next_in: "in 16h 4m" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "not_implemented" }), {
        status: 501,
        headers: { "content-type": "application/json" },
      });
    });
    vi.spyOn(global, "fetch").mockImplementation(
      fetchMock as unknown as typeof fetch,
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders scheduled jobs with cron and next-in", async () => {
    renderWithClient(<ScheduledRunsPanel />);
    await waitFor(() => {
      expect(screen.getByText("Scheduled runs")).toBeInTheDocument();
      expect(screen.getByText("vault-ingest")).toBeInTheDocument();
      expect(screen.getByText(/0 \* \* \* \* · last 15:00 ok/)).toBeInTheDocument();
      expect(screen.getByText("in 4m")).toBeInTheDocument();
      expect(screen.getByText("cost-report")).toBeInTheDocument();
      expect(screen.getByText("daily-brief")).toBeInTheDocument();
      expect(screen.getByText("3 jobs")).toBeInTheDocument();
    });
  });

  it("POSTs to trigger endpoint on play-button click", async () => {
    renderWithClient(<ScheduledRunsPanel />);
    const btn = await screen.findByLabelText("Trigger vault-ingest now");
    fireEvent.click(btn);
    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(
        calls.some((u) => u.endsWith("/api/tasks/scheduled/vault-ingest/trigger")),
      ).toBe(true);
    });
  });
});
