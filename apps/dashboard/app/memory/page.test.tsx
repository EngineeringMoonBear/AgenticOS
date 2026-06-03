import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, afterEach } from "vitest";
import MemoryPage from "./page";

// nuqs URL-state hook — stub so the page renders without a NuqsAdapter.
vi.mock("nuqs", () => ({
  useQueryState: () => ["", vi.fn()],
  parseAsString: { withDefault: () => ({}) },
}));

vi.mock("@/lib/filter/use-filter", () => ({
  useFilter: () => ({
    tags: [],
    setTags: vi.fn(),
    toggleTag: vi.fn(),
    clear: vi.fn(),
  }),
}));

// The page composes many heavy vault-backed panels; stub the siblings so the
// test isolates the left-rail inbox surface (MemoryTree → InboxQueue stays real).
vi.mock("@/components/shell/MemoryVista", () => ({ MemoryVista: () => null }));
vi.mock("@/components/memory/MemoryReader", () => ({
  MemoryReader: () => null,
}));
vi.mock("@/components/memory/MemoryRail", () => ({ MemoryRail: () => null }));
vi.mock("@/components/memory/MemorySyncIndicator", () => ({
  MemorySyncIndicator: () => null,
}));
vi.mock("@/components/memory/GraphCanvas", () => ({ GraphCanvas: () => null }));
vi.mock("@/components/memory/SkillsCatalogPanel", () => ({
  SkillsCatalogPanel: () => null,
}));
vi.mock("@/components/memory/RecentVaultChangesPanel", () => ({
  RecentVaultChangesPanel: () => null,
}));

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("Memory page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("surfaces the functional inbox in the left rail (no Phase E placeholder)", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      const body = url.includes("/api/vault/inbox")
        ? { items: [] }
        : { tree: { kind: "folder", name: "root", path: "", children: [] }, flatPaths: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    renderWithClient(<MemoryPage />);

    // Expand the inbox collapsible in the tree rail.
    fireEvent.click(screen.getByRole("button", { name: /Inbox/i }));

    expect(
      screen.queryByText(/Inbox processing wires up in Phase E/i),
    ).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/Inbox is empty/i)).toBeInTheDocument();
    });
  });
});
