import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { RoutinesPanel } from "./RoutinesPanel";

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

interface MockRoutine {
  id: string;
  name: string;
  enabled: boolean;
  cron: string | null;
  lastResult: string | null;
  managedByPlugin: string | null;
}

describe("RoutinesPanel", () => {
  let mockRoutines: MockRoutine[] = [];
  let fetchStatus = 200;

  beforeEach(() => {
    fetchStatus = 200;
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ routines: mockRoutines }), {
        status: fetchStatus,
        headers: { "content-type": "application/json" },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the panel title", async () => {
    mockRoutines = [];
    renderWithClient(<RoutinesPanel />);
    await waitFor(() => {
      expect(screen.getByText("Routines")).toBeInTheDocument();
    });
  });

  it("shows empty state when no routines are returned", async () => {
    mockRoutines = [];
    renderWithClient(<RoutinesPanel />);
    await waitFor(() => {
      expect(screen.getByText(/no routines/i)).toBeInTheDocument();
    });
  });

  it("renders routine row with name", async () => {
    mockRoutines = [
      {
        id: "r-1",
        name: "Daily standup report",
        enabled: true,
        cron: "0 9 * * *",
        lastResult: "success",
        managedByPlugin: null,
      },
    ];

    renderWithClient(<RoutinesPanel />);

    await waitFor(() => {
      expect(screen.getByText("Daily standup report")).toBeInTheDocument();
    });
  });

  it("renders cron expression when present", async () => {
    mockRoutines = [
      {
        id: "r-1",
        name: "Daily standup report",
        enabled: true,
        cron: "0 9 * * *",
        lastResult: "success",
        managedByPlugin: null,
      },
    ];

    renderWithClient(<RoutinesPanel />);

    await waitFor(() => {
      expect(screen.getByText("0 9 * * *")).toBeInTheDocument();
    });
  });

  it("renders '—' for cron when null", async () => {
    mockRoutines = [
      {
        id: "r-1",
        name: "PR triage",
        enabled: true,
        cron: null,
        lastResult: null,
        managedByPlugin: null,
      },
    ];

    renderWithClient(<RoutinesPanel />);

    await waitFor(() => {
      expect(screen.getByText("PR triage")).toBeInTheDocument();
      // At least one em-dash rendered for null fields
      expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    });
  });

  it("renders managed-by-plugin badge when managedByPlugin is present", async () => {
    mockRoutines = [
      {
        id: "r-2",
        name: "PR triage",
        enabled: true,
        cron: null,
        lastResult: null,
        managedByPlugin: "PR Triage Plugin",
      },
    ];

    renderWithClient(<RoutinesPanel />);

    await waitFor(() => {
      expect(screen.getByText("PR Triage Plugin")).toBeInTheDocument();
    });
  });

  it("does not render plugin badge when managedByPlugin is null", async () => {
    mockRoutines = [
      {
        id: "r-1",
        name: "Daily standup report",
        enabled: true,
        cron: "0 9 * * *",
        lastResult: "success",
        managedByPlugin: null,
      },
    ];

    renderWithClient(<RoutinesPanel />);

    await waitFor(() => {
      expect(screen.getByText("Daily standup report")).toBeInTheDocument();
    });

    // No plugin badge should be present
    expect(screen.queryByText(/plugin/i)).not.toBeInTheDocument();
  });

  it("renders last result when present", async () => {
    mockRoutines = [
      {
        id: "r-1",
        name: "Daily standup report",
        enabled: true,
        cron: "0 9 * * *",
        lastResult: "success",
        managedByPlugin: null,
      },
    ];

    renderWithClient(<RoutinesPanel />);

    await waitFor(() => {
      expect(screen.getByText("success")).toBeInTheDocument();
    });
  });

  it("renders multiple routine rows", async () => {
    mockRoutines = [
      {
        id: "r-1",
        name: "Daily standup report",
        enabled: true,
        cron: "0 9 * * *",
        lastResult: "success",
        managedByPlugin: null,
      },
      {
        id: "r-2",
        name: "PR triage",
        enabled: false,
        cron: null,
        lastResult: null,
        managedByPlugin: "PR Triage Plugin",
      },
    ];

    renderWithClient(<RoutinesPanel />);

    await waitFor(() => {
      expect(screen.getByText("Daily standup report")).toBeInTheDocument();
      expect(screen.getByText("PR triage")).toBeInTheDocument();
      expect(screen.getByText("PR Triage Plugin")).toBeInTheDocument();
    });
  });

  it("shows error state when the fetch fails", async () => {
    fetchStatus = 503;
    mockRoutines = [];
    renderWithClient(<RoutinesPanel />);

    await waitFor(() => {
      expect(screen.getByText(/failed to load routines/i)).toBeInTheDocument();
    });
  });

  it("shows routine count in the panel action area", async () => {
    mockRoutines = [
      {
        id: "r-1",
        name: "Alpha",
        enabled: true,
        cron: "0 9 * * *",
        lastResult: null,
        managedByPlugin: null,
      },
      {
        id: "r-2",
        name: "Beta",
        enabled: false,
        cron: null,
        lastResult: null,
        managedByPlugin: null,
      },
    ];

    renderWithClient(<RoutinesPanel />);

    await waitFor(() => {
      expect(screen.getByText("2 routines")).toBeInTheDocument();
    });
  });

  it("renders singular 'routine' for one routine", async () => {
    mockRoutines = [
      {
        id: "r-1",
        name: "Alpha",
        enabled: true,
        cron: "0 9 * * *",
        lastResult: null,
        managedByPlugin: null,
      },
    ];

    renderWithClient(<RoutinesPanel />);

    await waitFor(() => {
      expect(screen.getByText("1 routine")).toBeInTheDocument();
    });
  });

  it("renders enabled pill for active routine", async () => {
    mockRoutines = [
      {
        id: "r-1",
        name: "Alpha",
        enabled: true,
        cron: "0 9 * * *",
        lastResult: null,
        managedByPlugin: null,
      },
    ];

    renderWithClient(<RoutinesPanel />);

    await waitFor(() => {
      expect(screen.getByText("enabled")).toBeInTheDocument();
    });
  });

  it("renders disabled pill for inactive routine", async () => {
    mockRoutines = [
      {
        id: "r-1",
        name: "Alpha",
        enabled: false,
        cron: null,
        lastResult: null,
        managedByPlugin: null,
      },
    ];

    renderWithClient(<RoutinesPanel />);

    await waitFor(() => {
      expect(screen.getByText("disabled")).toBeInTheDocument();
    });
  });
});
