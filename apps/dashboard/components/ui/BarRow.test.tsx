import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BarRow } from "./BarRow";

describe("BarRow", () => {
  it("renders name, scope, count and a fill bar at the requested width", () => {
    const { container } = render(
      <BarRow name="OpenViking" scope="prod" fillPercent={42} count={1234} />,
    );
    expect(screen.getByText("OpenViking")).toBeDefined();
    expect(screen.getByText("prod")).toBeDefined();
    expect(screen.getByText("1234")).toBeDefined();
    const fill = container.querySelector(".bar-row .fill") as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill.style.width).toBe("42%");
  });

  it("clamps fillPercent out of range", () => {
    const { container, rerender } = render(
      <BarRow name="x" fillPercent={150} count="0" />,
    );
    expect(
      (container.querySelector(".bar-row .fill") as HTMLElement).style.width,
    ).toBe("100%");
    rerender(<BarRow name="x" fillPercent={-5} count="0" />);
    expect(
      (container.querySelector(".bar-row .fill") as HTMLElement).style.width,
    ).toBe("0%");
  });

  it("omits scope when not provided", () => {
    const { container } = render(<BarRow name="x" fillPercent={10} count={1} />);
    expect(container.querySelector(".scope")).toBeNull();
  });
});
