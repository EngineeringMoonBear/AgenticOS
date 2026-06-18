import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { IssuesPanel } from "./IssuesPanel";

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

interface MockIssue {
  id: string;
  title: string;
  status: string;
  assignee: string | null;
  priority: string | null;
}

describe("IssuesPanel", () => {
  let mockIssues: MockIssue[] = [];
  let fetchStatus = 200;

  beforeEach(() => {
    fetchStatus = 200;
    mockIssues = [];
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ issues: mockIssues }), {
        status: fetchStatus,
        headers: { "content-type": "application/json" },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the panel title", async () => {
    renderWithClient(<IssuesPanel />);
    await waitFor(() => {
      expect(screen.getByText("Issues")).toBeInTheDocument();
    });
  });

  it("shows empty state when no issues are returned", async () => {
    renderWithClient(<IssuesPanel />);
    await waitFor(() => {
      expect(screen.getByText(/no issues found/i)).toBeInTheDocument();
    });
  });

  it("renders issue title, status pill, and assignee", async () => {
    mockIssues = [
      {
        id: "issue-1",
        title: "Fix auth bug",
        status: "in_progress",
        assignee: "agent-abc",
        priority: "high",
      },
    ];

    renderWithClient(<IssuesPanel />);

    await waitFor(() => {
      expect(screen.getByText("Fix auth bug")).toBeInTheDocument();
      expect(screen.getByText("in_progress")).toBeInTheDocument();
      expect(screen.getByText("agent-abc")).toBeInTheDocument();
      expect(screen.getByText("High")).toBeInTheDocument();
    });
  });

  it("renders 'unassigned' when assignee is null", async () => {
    mockIssues = [
      {
        id: "issue-2",
        title: "Write tests",
        status: "todo",
        assignee: null,
        priority: null,
      },
    ];

    renderWithClient(<IssuesPanel />);

    await waitFor(() => {
      expect(screen.getByText("Write tests")).toBeInTheDocument();
      expect(screen.getByText("unassigned")).toBeInTheDocument();
    });
  });

  it("renders no priority badge when priority is null", async () => {
    mockIssues = [
      {
        id: "issue-3",
        title: "No priority issue",
        status: "backlog",
        assignee: null,
        priority: null,
      },
    ];

    renderWithClient(<IssuesPanel />);

    await waitFor(() => {
      expect(screen.getByText("No priority issue")).toBeInTheDocument();
      // Priority badge should not appear
      expect(screen.queryByText(/high|medium|low/i)).not.toBeInTheDocument();
    });
  });

  it("groups issues by status with a status heading", async () => {
    mockIssues = [
      {
        id: "issue-1",
        title: "Alpha task",
        status: "in_progress",
        assignee: "agent-a",
        priority: "high",
      },
      {
        id: "issue-2",
        title: "Beta task",
        status: "todo",
        assignee: "agent-b",
        priority: "low",
      },
      {
        id: "issue-3",
        title: "Gamma task",
        status: "in_progress",
        assignee: null,
        priority: null,
      },
    ];

    renderWithClient(<IssuesPanel />);

    await waitFor(() => {
      // Both issues with status "in_progress" are rendered
      expect(screen.getByText("Alpha task")).toBeInTheDocument();
      expect(screen.getByText("Gamma task")).toBeInTheDocument();
      // The todo issue is rendered
      expect(screen.getByText("Beta task")).toBeInTheDocument();
      // Status group headings appear (formatted from snake_case)
      expect(screen.getByText("In Progress")).toBeInTheDocument();
      expect(screen.getByText("Todo")).toBeInTheDocument();
    });
  });

  it("renders multiple issues across different statuses", async () => {
    mockIssues = [
      {
        id: "issue-1",
        title: "Blocked issue",
        status: "blocked",
        assignee: "agent-x",
        priority: "urgent",
      },
      {
        id: "issue-2",
        title: "Done issue",
        status: "done",
        assignee: null,
        priority: null,
      },
    ];

    renderWithClient(<IssuesPanel />);

    await waitFor(() => {
      expect(screen.getByText("Blocked issue")).toBeInTheDocument();
      expect(screen.getByText("Done issue")).toBeInTheDocument();
      expect(screen.getByText("Blocked")).toBeInTheDocument();
      expect(screen.getByText("Done")).toBeInTheDocument();
    });
  });

  it("shows issue count in the panel action area", async () => {
    mockIssues = [
      {
        id: "issue-1",
        title: "Task one",
        status: "todo",
        assignee: null,
        priority: null,
      },
      {
        id: "issue-2",
        title: "Task two",
        status: "in_progress",
        assignee: null,
        priority: null,
      },
    ];

    renderWithClient(<IssuesPanel />);

    await waitFor(() => {
      expect(screen.getByText("2 issues")).toBeInTheDocument();
    });
  });

  it("renders singular 'issue' for one issue", async () => {
    mockIssues = [
      {
        id: "issue-1",
        title: "Single task",
        status: "todo",
        assignee: null,
        priority: null,
      },
    ];

    renderWithClient(<IssuesPanel />);

    await waitFor(() => {
      expect(screen.getByText("1 issue")).toBeInTheDocument();
    });
  });

  it("shows error state when the fetch fails", async () => {
    fetchStatus = 503;
    renderWithClient(<IssuesPanel />);

    await waitFor(() => {
      expect(screen.getByText(/failed to load issues/i)).toBeInTheDocument();
    });
  });

  it("in_progress issues appear before todo in status groups", async () => {
    mockIssues = [
      {
        id: "issue-1",
        title: "Todo task",
        status: "todo",
        assignee: null,
        priority: null,
      },
      {
        id: "issue-2",
        title: "In progress task",
        status: "in_progress",
        assignee: null,
        priority: null,
      },
    ];

    renderWithClient(<IssuesPanel />);

    await waitFor(() => {
      const headings = screen
        .getAllByText(/In Progress|Todo/)
        .map((el) => el.textContent);
      // "In Progress" should come before "Todo"
      const inProgressIdx = headings.indexOf("In Progress");
      const todoIdx = headings.indexOf("Todo");
      expect(inProgressIdx).toBeLessThan(todoIdx);
    });
  });
});
