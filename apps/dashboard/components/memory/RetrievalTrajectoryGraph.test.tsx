import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import * as trajectoryHook from "@/lib/hooks/use-trajectory";
import { RetrievalTrajectoryGraph } from "./RetrievalTrajectoryGraph";

// next/dynamic loads the force graph in a way that pulls in canvas APIs jsdom
// can't handle — short-circuit it.
vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));

function renderGraph(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

type TrajectoryHookReturn = ReturnType<typeof trajectoryHook.useTrajectory>;

function mockReturn(
  partial: Partial<TrajectoryHookReturn>,
): TrajectoryHookReturn {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    isSuccess: false,
    ...partial,
  } as unknown as TrajectoryHookReturn;
}

describe("RetrievalTrajectoryGraph", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders degraded state when trajectory data is unavailable", () => {
    vi.spyOn(trajectoryHook, "useTrajectory").mockReturnValue(
      mockReturn({
        data: { nodes: [], links: [], available: false },
        isLoading: false,
      }),
    );
    renderGraph(
      <RetrievalTrajectoryGraph uri="viking://agent/skills/x.md" />,
    );
    expect(screen.getByText(/not available/i)).toBeInTheDocument();
  });

  it("renders empty state when no retrievals in the window", () => {
    vi.spyOn(trajectoryHook, "useTrajectory").mockReturnValue(
      mockReturn({
        data: { nodes: [], links: [] },
        isLoading: false,
        isSuccess: true,
      }),
    );
    renderGraph(
      <RetrievalTrajectoryGraph uri="viking://agent/skills/x.md" />,
    );
    expect(
      screen.getByText(/no retrievals in this window/i),
    ).toBeInTheDocument();
  });

  it("renders loading state", () => {
    vi.spyOn(trajectoryHook, "useTrajectory").mockReturnValue(
      mockReturn({ isLoading: true }),
    );
    renderGraph(
      <RetrievalTrajectoryGraph uri="viking://agent/skills/x.md" />,
    );
    expect(screen.getByText(/loading trajectory/i)).toBeInTheDocument();
  });

  it("changes active range when a range chip is clicked", () => {
    const spy = vi
      .spyOn(trajectoryHook, "useTrajectory")
      .mockReturnValue(
        mockReturn({
          data: { nodes: [], links: [] },
          isLoading: false,
          isSuccess: true,
        }),
      );
    renderGraph(
      <RetrievalTrajectoryGraph uri="viking://agent/skills/x.md" />,
    );

    // Default = 30d
    const tab30 = screen.getByRole("tab", { name: "30d" });
    const tab7 = screen.getByRole("tab", { name: "7d" });
    expect(tab30).toHaveAttribute("aria-selected", "true");
    expect(tab7).toHaveAttribute("aria-selected", "false");

    fireEvent.click(tab7);
    expect(tab7).toHaveAttribute("aria-selected", "true");
    expect(tab30).toHaveAttribute("aria-selected", "false");

    // The hook should have been called with multiple distinct `since` values
    // as the chip changed.
    const sinceValues = new Set(
      spy.mock.calls.map((c) => c[1] as string | undefined),
    );
    expect(sinceValues.size).toBeGreaterThanOrEqual(2);
  });
});
