import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { SkillsCatalogPanel } from "./SkillsCatalogPanel";

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("SkillsCatalogPanel", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          total_registered: 11,
          skills: [
            { name: "farm-task-triage", used_by: "used by curator · daily-brief", invocations: 12 },
            { name: "code-review", used_by: "used by curator", invocations: 8 },
            { name: "daily-summary", used_by: "used by daily-brief", invocations: 3 },
            { name: "expense-categorize", used_by: "used by cost-report", invocations: 2 },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders skill rows with invocation counts", async () => {
    renderWithClient(<SkillsCatalogPanel />);
    await waitFor(() => {
      expect(screen.getByText("Skills catalog")).toBeInTheDocument();
      expect(screen.getByText("11 registered")).toBeInTheDocument();
      expect(screen.getByText("farm-task-triage")).toBeInTheDocument();
      expect(screen.getByText("used by curator · daily-brief")).toBeInTheDocument();
      expect(screen.getByText("12")).toBeInTheDocument();
      expect(screen.getByText("expense-categorize")).toBeInTheDocument();
    });
  });
});
