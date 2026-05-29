import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VistaShell } from "./VistaShell";
import { KpiTile } from "./KpiTile";

describe("VistaShell", () => {
  it("renders the dusk console chrome with horizons and live meta", () => {
    const { container } = render(
      <VistaShell backdrop={<div data-testid="bd" />}>
        <KpiTile value="1" label="alpha" />
        <KpiTile value="2" label="beta" />
        <KpiTile value="3" label="gamma" />
        <KpiTile value="4" label="delta" />
      </VistaShell>,
    );
    expect(container.querySelector(".kpi-vista")).not.toBeNull();
    expect(container.querySelectorAll(".horizon").length).toBe(2);
    expect(container.querySelector(".vista-meta")).not.toBeNull();
    expect(container.querySelector(".live-dot")).not.toBeNull();
    expect(screen.getByTestId("bd")).toBeTruthy();
  });

  it("renders the supplied KPI tiles inside .kpi-grid", () => {
    const { container } = render(
      <VistaShell backdrop={null}>
        <KpiTile value="1" label="alpha" />
        <KpiTile value="2" label="beta" />
        <KpiTile value="3" label="gamma" />
        <KpiTile value="4" label="delta" />
      </VistaShell>,
    );
    const tiles = container.querySelectorAll(".kpi-grid > .kpi");
    expect(tiles.length).toBe(4);
  });

  it("applies data-accent attribute (defaults to gold)", () => {
    const { container, rerender } = render(
      <VistaShell backdrop={null}>
        <KpiTile value="x" label="x" />
      </VistaShell>,
    );
    expect(
      container.querySelector(".kpi-vista")?.getAttribute("data-accent"),
    ).toBe("gold");

    rerender(
      <VistaShell accent="copper" backdrop={null}>
        <KpiTile value="x" label="x" />
      </VistaShell>,
    );
    expect(
      container.querySelector(".kpi-vista")?.getAttribute("data-accent"),
    ).toBe("copper");
  });

  it("formats asOf into HH:MM:SS in the live indicator", () => {
    const { container } = render(
      <VistaShell asOf="2026-05-28T09:07:03Z" backdrop={null}>
        <KpiTile value="x" label="x" />
      </VistaShell>,
    );
    // Just assert the meta has a HH:MM:SS-shaped string — exact value depends
    // on the test runner's locale TZ.
    expect(container.querySelector(".vista-meta")?.textContent).toMatch(
      /Live · as of \d{2}:\d{2}:\d{2}/,
    );
  });
});
