import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Pill } from "./Pill";

describe("Pill", () => {
  it("renders children and dot by default", () => {
    const { container } = render(<Pill variant="ok">ok</Pill>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("pill");
    expect(el.className).toContain("ok");
    expect(el.querySelector(".dot")).not.toBeNull();
    expect(screen.getByText("ok")).toBeDefined();
  });

  it("hides dot when showDot is false", () => {
    const { container } = render(
      <Pill variant="err" showDot={false}>
        err
      </Pill>,
    );
    expect((container.firstChild as HTMLElement).querySelector(".dot")).toBeNull();
  });

  it.each(["ok", "warn", "err", "run", "stuck"] as const)(
    "applies %s variant class",
    (variant) => {
      const { container } = render(<Pill variant={variant}>x</Pill>);
      expect((container.firstChild as HTMLElement).className).toContain(variant);
    },
  );
});
