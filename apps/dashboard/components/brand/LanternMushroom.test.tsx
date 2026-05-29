import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LanternMushroom } from "./LanternMushroom";

describe("LanternMushroom", () => {
  it("renders an SVG at the default 26x26 size", () => {
    const { container } = render(<LanternMushroom />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("width")).toBe("26");
    expect(svg?.getAttribute("height")).toBe("26");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 26 26");
    // Decorative by default.
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("respects a custom size", () => {
    const { container } = render(<LanternMushroom size={40} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("40");
    expect(svg?.getAttribute("height")).toBe("40");
  });

  it("exposes role=img and aria-label when ariaLabel is provided", () => {
    const { container } = render(<LanternMushroom ariaLabel="AgenticOS home" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe("AgenticOS home");
    expect(svg?.getAttribute("aria-hidden")).toBeNull();
  });

  it("generates unique gradient ids across multiple instances", () => {
    const { container } = render(
      <>
        <LanternMushroom />
        <LanternMushroom />
      </>,
    );
    const gradients = container.querySelectorAll("radialGradient");
    expect(gradients.length).toBe(2);
    const ids = Array.from(gradients).map((g) => g.getAttribute("id"));
    expect(new Set(ids).size).toBe(2);
  });
});
