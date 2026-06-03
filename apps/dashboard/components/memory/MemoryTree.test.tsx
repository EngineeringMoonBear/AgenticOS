import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, afterEach } from "vitest";
import { MemoryTree } from "./MemoryTree";

// The filter hook is backed by nuqs (URL state); stub it so the tree renders
// without a NuqsAdapter in the test tree.
vi.mock("@/lib/filter/use-filter", () => ({
  useFilter: () => ({
    tags: [],
    setTags: vi.fn(),
    toggleTag: vi.fn(),
    clear: vi.fn(),
  }),
}));

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

function mockFetch(handlers: Record<string, unknown>) {
  vi.spyOn(global, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const match = Object.keys(handlers).find((k) => url.includes(k));
    const body = match ? handlers[match] : {};
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

const EMPTY_TREE = {
  tree: { kind: "folder", name: "root", path: "", children: [] },
  flatPaths: [],
};

describe("MemoryTree inbox section", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mounts the functional InboxQueue (not the Phase E placeholder)", async () => {
    mockFetch({
      "/api/vault/tree": EMPTY_TREE,
      "/api/vault/inbox": { items: [] },
    });

    renderWithClient(<MemoryTree selectedPath={null} onSelect={vi.fn()} />);

    // Expand the inbox collapsible.
    fireEvent.click(screen.getByRole("button", { name: /Inbox/i }));

    // The dead placeholder must be gone…
    expect(
      screen.queryByText(/Inbox processing wires up in Phase E/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Browse inbox/i),
    ).not.toBeInTheDocument();

    // …and the real queue's empty state must render once the inbox loads.
    await waitFor(() => {
      expect(screen.getByText(/Inbox is empty/i)).toBeInTheDocument();
    });
  });

  it("renders live inbox items with Promote and Discard actions", async () => {
    mockFetch({
      "/api/vault/tree": EMPTY_TREE,
      "/api/vault/inbox": {
        items: [
          { path: "inbox/note-1.md", title: "Captured idea", body: "hello" },
        ],
      },
    });

    renderWithClient(<MemoryTree selectedPath={null} onSelect={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Inbox/i }));

    await waitFor(() => {
      expect(screen.getByText("Captured idea")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /Promote/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Discard/i }),
    ).toBeInTheDocument();
  });
});
