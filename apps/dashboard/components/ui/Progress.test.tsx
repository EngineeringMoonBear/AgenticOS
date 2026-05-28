import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Progress } from "./Progress";

describe("Progress", () => {
  it("renders name, count, and fill width matching percent", () => {
    const { container } = render(
      <Progress
        name="Rate limit"
        count="73,420 / 100,000"
        percent={73}
        variant="pine"
      />,
    );
    expect(screen.getByText("Rate limit")).toBeDefined();
    expect(screen.getByText("73,420 / 100,000")).toBeDefined();
    const fill = container.querySelector(".progress-fill") as HTMLElement;
    expect(fill.style.width).toBe("73%");
    expect(fill.className).toContain("pine");
  });

  it.each(["pine", "amber", "gold"] as const)(
    "applies %s variant class",
    (variant) => {
      const { container } = render(
        <Progress name="x" count="0" percent={0} variant={variant} />,
      );
      expect(
        (container.querySelector(".progress-fill") as HTMLElement).className,
      ).toContain(variant);
    },
  );

  it("clamps percent out of range", () => {
    const { container } = render(
      <Progress name="x" count="0" percent={250} variant="gold" />,
    );
    expect(
      (container.querySelector(".progress-fill") as HTMLElement).style.width,
    ).toBe("100%");
  });
});
