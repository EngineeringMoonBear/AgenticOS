import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi, beforeEach } from "vitest";
import * as treeHook from "@/lib/hooks/use-memory-tree";
import { CategoryBrowser } from "./CategoryBrowser";

function renderBrowser(
  ui: React.ReactNode,
  search: string = "?scope=resources",
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NuqsTestingAdapter searchParams={search}>{ui}</NuqsTestingAdapter>
    </QueryClientProvider>,
  );
}

// Helper to type the mocked return.
type TreeHookReturn = ReturnType<typeof treeHook.useMemoryTree>;

function mockReturn(partial: Partial<TreeHookReturn>): TreeHookReturn {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    isSuccess: false,
    ...partial,
  } as unknown as TreeHookReturn;
}

describe("CategoryBrowser", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders loading state", () => {
    vi.spyOn(treeHook, "useMemoryTree").mockReturnValue(
      mockReturn({ isLoading: true }),
    );
    renderBrowser(<CategoryBrowser selectedUri={null} onSelect={() => {}} />);
    expect(screen.getByRole("status", { name: /loading/i })).toBeInTheDocument();
  });

  it("renders error state", () => {
    vi.spyOn(treeHook, "useMemoryTree").mockReturnValue(
      mockReturn({ isError: true }),
    );
    renderBrowser(<CategoryBrowser selectedUri={null} onSelect={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/failed/i);
  });

  it("renders empty state", () => {
    vi.spyOn(treeHook, "useMemoryTree").mockReturnValue(
      mockReturn({ data: { nodes: [] }, isSuccess: true }),
    );
    renderBrowser(<CategoryBrowser selectedUri={null} onSelect={() => {}} />);
    expect(screen.getByText(/no memories/i)).toBeInTheDocument();
  });

  it("renders nodes and invokes onSelect on click", async () => {
    vi.spyOn(treeHook, "useMemoryTree").mockReturnValue(
      mockReturn({
        data: {
          nodes: [
            { name: "a", uri: "viking://resources/a", type: "file" },
            { name: "b", uri: "viking://resources/b", type: "dir" },
          ],
        },
        isSuccess: true,
      }),
    );
    const onSelect = vi.fn();
    renderBrowser(<CategoryBrowser selectedUri={null} onSelect={onSelect} />);
    expect(screen.getByRole("treeitem", { name: /^a/ })).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: /^b/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("treeitem", { name: /^a/ }));
    expect(onSelect).toHaveBeenCalledWith("viking://resources/a");
  });

  it("marks selected node with aria-current", () => {
    vi.spyOn(treeHook, "useMemoryTree").mockReturnValue(
      mockReturn({
        data: {
          nodes: [{ name: "a", uri: "viking://resources/a", type: "file" }],
        },
        isSuccess: true,
      }),
    );
    renderBrowser(
      <CategoryBrowser
        selectedUri="viking://resources/a"
        onSelect={() => {}}
      />,
    );
    const node = screen.getByRole("treeitem", { name: /^a/ });
    expect(node).toHaveAttribute("aria-current", "true");
  });
});
