import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, afterEach } from "vitest";
import ArchitecturePage from "./page";

vi.mock("@/lib/filter/use-filter", () => ({
  useFilter: () => ({
    tags: [],
    setTags: vi.fn(),
    toggleTag: vi.fn(),
    clear: vi.fn(),
  }),
}));

vi.mock("@/components/shell/ArchitectureVista", () => ({
  ArchitectureVista: () => null,
}));

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

const SKILLS_RESPONSE = {
  totalRegistered: 2,
  skills: [
    {
      name: "Run grove-sites tests",
      description: "Runs the vitest suite and reports failures.",
      triggers: ["ci-green"],
      usedBy: [],
      path: "wiki/Skills/Software/run-tests.md",
    },
    {
      name: "Weekly farm report",
      description: "Aggregates farmOS sensor data into a report.",
      triggers: [],
      usedBy: [],
      path: "wiki/Skills/Farm/weekly-report.md",
    },
  ],
};

describe("Architecture page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders skill cards from the useVaultSkills hook", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify(SKILLS_RESPONSE), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    renderWithClient(<ArchitecturePage />);

    await waitFor(() => {
      expect(screen.getByText("Run grove-sites tests")).toBeInTheDocument();
      expect(screen.getByText("Weekly farm report")).toBeInTheDocument();
    });

    // Domain tag is derived from the path segment after Skills/.
    expect(screen.getByText("#software")).toBeInTheDocument();
    expect(screen.getByText("#farm")).toBeInTheDocument();
    // Trigger rides along as a tag.
    expect(screen.getByText("#ci-green")).toBeInTheDocument();
  });

  it("renders the unavailable state when the fetch fails", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      return new Response("", { status: 502 });
    });

    renderWithClient(<ArchitecturePage />);

    await waitFor(() => {
      expect(screen.getByText("Skills catalog unavailable")).toBeInTheDocument();
    });
  });

  it("renders an empty state when no skills are registered", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ totalRegistered: 0, skills: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    renderWithClient(<ArchitecturePage />);

    await waitFor(() => {
      expect(screen.getByText("No skills registered")).toBeInTheDocument();
    });
  });
});
