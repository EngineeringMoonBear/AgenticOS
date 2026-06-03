import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { KpiVista } from "./KpiVista";

function renderWithQuery(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("KpiVista", () => {
  it("renders four KPI tiles", () => {
    const { container } = renderWithQuery(<KpiVista />);
    const tiles = container.querySelectorAll(".kpi-grid > .kpi");
    expect(tiles.length).toBe(4);
  });

  it("renders the four KPI labels", () => {
    renderWithQuery(<KpiVista />);
    expect(screen.getByText(/today's spend/i)).toBeTruthy();
    expect(screen.getByText(/active runs/i)).toBeTruthy();
    expect(screen.getByText(/vault files/i)).toBeTruthy();
    expect(screen.getByText(/memories indexed/i)).toBeTruthy();
  });

  it("shows the live indicator", () => {
    const { container } = renderWithQuery(<KpiVista />);
    const meta = container.querySelector(".vista-meta");
    expect(meta).not.toBeNull();
    expect(meta?.textContent).toMatch(/Live/);
    expect(container.querySelector(".live-dot")).not.toBeNull();
  });

  it("does not crash when query data is still loading (no data yet)", () => {
    // First synchronous render happens before queryFn resolves; tiles should
    // still mount with em-dash placeholders.
    const { container } = renderWithQuery(<KpiVista />);
    expect(container.querySelector(".kpi-vista")).not.toBeNull();
  });

  it("mounts the EKG backdrop", () => {
    const { container } = renderWithQuery(<KpiVista />);
    expect(container.querySelector(".ekg-backdrop")).not.toBeNull();
    expect(container.querySelector(".ekg-trace")).not.toBeNull();
  });
});
