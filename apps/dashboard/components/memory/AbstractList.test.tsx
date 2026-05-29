import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import * as abstractsHook from "@/lib/hooks/use-memory-abstracts";
import { AbstractList } from "./AbstractList";

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

type HookReturn = ReturnType<typeof abstractsHook.useMemoryAbstracts>;
function mockReturn(partial: Partial<HookReturn>): HookReturn {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    isSuccess: false,
    ...partial,
  } as unknown as HookReturn;
}

describe("AbstractList", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders 'no parent selected' empty state", () => {
    vi.spyOn(abstractsHook, "useMemoryAbstracts").mockReturnValue(
      mockReturn({}),
    );
    renderWithClient(
      <AbstractList parentUri="" selectedUri={null} onSelect={() => {}} />,
    );
    expect(screen.getByText(/select a category/i)).toBeInTheDocument();
  });

  it("renders loading state when parent is set", () => {
    vi.spyOn(abstractsHook, "useMemoryAbstracts").mockReturnValue(
      mockReturn({ isLoading: true }),
    );
    renderWithClient(
      <AbstractList
        parentUri="viking://resources"
        selectedUri={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole("status", { name: /loading/i })).toBeInTheDocument();
  });

  it("renders error state", () => {
    vi.spyOn(abstractsHook, "useMemoryAbstracts").mockReturnValue(
      mockReturn({ isError: true }),
    );
    renderWithClient(
      <AbstractList
        parentUri="viking://resources"
        selectedUri={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/failed/i);
  });

  it("renders empty list when items are empty", () => {
    vi.spyOn(abstractsHook, "useMemoryAbstracts").mockReturnValue(
      mockReturn({ data: { items: [] }, isSuccess: true }),
    );
    renderWithClient(
      <AbstractList
        parentUri="viking://resources"
        selectedUri={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText(/no abstracts/i)).toBeInTheDocument();
  });

  it("renders items and invokes onSelect on click", () => {
    vi.spyOn(abstractsHook, "useMemoryAbstracts").mockReturnValue(
      mockReturn({
        data: {
          items: [
            {
              uri: "viking://resources/a",
              name: "alpha",
              abstract: "alpha summary",
            },
            {
              uri: "viking://resources/b",
              name: "beta",
              abstract: "beta summary",
            },
          ],
        },
        isSuccess: true,
      }),
    );
    const onSelect = vi.fn();
    renderWithClient(
      <AbstractList
        parentUri="viking://resources"
        selectedUri={null}
        onSelect={onSelect}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    fireEvent.click(items[0]);
    expect(onSelect).toHaveBeenCalledWith("viking://resources/a");
  });

  it("marks selected item with aria-current", () => {
    vi.spyOn(abstractsHook, "useMemoryAbstracts").mockReturnValue(
      mockReturn({
        data: {
          items: [
            {
              uri: "viking://resources/a",
              name: "alpha",
              abstract: "alpha summary",
            },
          ],
        },
        isSuccess: true,
      }),
    );
    renderWithClient(
      <AbstractList
        parentUri="viking://resources"
        selectedUri="viking://resources/a"
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole("listitem")).toHaveAttribute("aria-current", "true");
  });
});
