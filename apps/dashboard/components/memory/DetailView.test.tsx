import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import * as overviewHook from "@/lib/hooks/use-memory-overview";
import * as detailHook from "@/lib/hooks/use-memory-detail";
import { DetailView } from "./DetailView";

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

type OverviewRet = ReturnType<typeof overviewHook.useMemoryOverview>;
type DetailRet = ReturnType<typeof detailHook.useMemoryDetail>;

function mockOverview(partial: Partial<OverviewRet>): OverviewRet {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    isSuccess: false,
    ...partial,
  } as unknown as OverviewRet;
}
function mockDetail(partial: Partial<DetailRet>): DetailRet {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    isSuccess: false,
    ...partial,
  } as unknown as DetailRet;
}

describe("DetailView", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders empty state when uri is empty", () => {
    vi.spyOn(overviewHook, "useMemoryOverview").mockReturnValue(mockOverview({}));
    vi.spyOn(detailHook, "useMemoryDetail").mockReturnValue(mockDetail({}));
    renderWithClient(<DetailView uri="" />);
    expect(screen.getByText(/select an abstract/i)).toBeInTheDocument();
  });

  it("renders overview when loaded", () => {
    vi.spyOn(overviewHook, "useMemoryOverview").mockReturnValue(
      mockOverview({
        data: { uri: "viking://x", overview: "this is the overview" },
        isSuccess: true,
      }),
    );
    vi.spyOn(detailHook, "useMemoryDetail").mockReturnValue(mockDetail({}));
    renderWithClient(<DetailView uri="viking://x" />);
    expect(screen.getByText(/this is the overview/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /load full content/i }),
    ).toBeInTheDocument();
  });

  it("clicking Load full content shows detail loading state", () => {
    vi.spyOn(overviewHook, "useMemoryOverview").mockReturnValue(
      mockOverview({
        data: { uri: "viking://x", overview: "o" },
        isSuccess: true,
      }),
    );
    vi.spyOn(detailHook, "useMemoryDetail").mockReturnValue(
      mockDetail({ isLoading: true }),
    );
    renderWithClient(<DetailView uri="viking://x" />);
    fireEvent.click(screen.getByRole("button", { name: /load full content/i }));
    expect(
      screen.getByRole("status", { name: /loading detail/i }),
    ).toBeInTheDocument();
  });

  it("renders detail content with pagination; Prev disabled at offset 0", () => {
    vi.spyOn(overviewHook, "useMemoryOverview").mockReturnValue(
      mockOverview({
        data: { uri: "viking://x", overview: "o" },
        isSuccess: true,
      }),
    );
    vi.spyOn(detailHook, "useMemoryDetail").mockReturnValue(
      mockDetail({
        data: {
          uri: "viking://x",
          content: "the file content",
          offset: 0,
          limit: 8192,
          total_offset: 20000,
        },
        isSuccess: true,
      }),
    );
    renderWithClient(<DetailView uri="viking://x" />);
    fireEvent.click(screen.getByRole("button", { name: /load full content/i }));
    expect(screen.getByText(/the file content/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /previous page/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /next page/i })).not.toBeDisabled();
    expect(screen.getByText(/showing bytes/i)).toHaveTextContent(
      /0.*8,192.*20,000/,
    );
  });

  it("toggles between Detail and Trace tabs", () => {
    vi.spyOn(overviewHook, "useMemoryOverview").mockReturnValue(
      mockOverview({
        data: { uri: "viking://x", overview: "the overview" },
        isSuccess: true,
      }),
    );
    vi.spyOn(detailHook, "useMemoryDetail").mockReturnValue(mockDetail({}));
    renderWithClient(<DetailView uri="viking://x" />);
    expect(screen.getByText(/the overview/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /trace usage/i }));
    expect(screen.getByRole("region", { name: /trajectory/i })).toBeInTheDocument();
    expect(screen.queryByText(/the overview/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /^detail$/i }));
    expect(screen.getByText(/the overview/)).toBeInTheDocument();
  });
});
