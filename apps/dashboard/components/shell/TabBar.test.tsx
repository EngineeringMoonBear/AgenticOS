import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/runs",
}));

import { TabBar } from "./TabBar";

describe("TabBar", () => {
  it("renders all four tabs with the expected hrefs", () => {
    render(<TabBar />);
    expect(screen.getByRole("tab", { name: /Runs/ }).getAttribute("href")).toBe(
      "/runs",
    );
    expect(screen.getByRole("tab", { name: /Cost/ }).getAttribute("href")).toBe(
      "/cost",
    );
    expect(
      screen.getByRole("tab", { name: /Health/ }).getAttribute("href"),
    ).toBe("/health");
    expect(
      screen.getByRole("tab", { name: /Memory/ }).getAttribute("href"),
    ).toBe("/memory");
  });

  it("marks the active tab with aria-selected=true and others false", () => {
    render(<TabBar />);
    expect(
      screen.getByRole("tab", { name: /Runs/ }).getAttribute("aria-selected"),
    ).toBe("true");
    for (const name of [/Cost/, /Health/, /Memory/]) {
      expect(
        screen.getByRole("tab", { name }).getAttribute("aria-selected"),
      ).toBe("false");
    }
  });

  it("renders hard-coded count badges per the 3.5.3 spec", () => {
    render(<TabBar />);
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("$2.41")).toBeTruthy();
    expect(screen.getByText("2 warn")).toBeTruthy();
    expect(screen.getByText("1,652")).toBeTruthy();
  });
});
