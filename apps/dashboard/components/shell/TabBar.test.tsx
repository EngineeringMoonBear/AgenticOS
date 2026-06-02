import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/runs",
}));

import { TabBar } from "./TabBar";

describe("TabBar", () => {
  it("renders all five desktop tabs with the expected hrefs", () => {
    render(<TabBar />);
    expect(screen.getByRole("tab", { name: /Runs/ }).getAttribute("href")).toBe(
      "/runs",
    );
    expect(
      screen.getByRole("tab", { name: /Architecture/ }).getAttribute("href"),
    ).toBe("/architecture");
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
    for (const name of [/Architecture/, /Cost/, /Health/, /Memory/]) {
      expect(
        screen.getByRole("tab", { name }).getAttribute("aria-selected"),
      ).toBe("false");
    }
  });

  it("renders count badges in the desktop tab bar", () => {
    render(<TabBar />);
    // Desktop tab bar (role="tablist") contains the count badges
    const tablist = screen.getByRole("tablist");
    expect(tablist.textContent).toContain("3");
    expect(tablist.textContent).toContain("11");
    expect(tablist.textContent).toContain("$2.41");
    expect(tablist.textContent).toContain("2 warn");
    expect(tablist.textContent).toContain("1,652");
  });

  it("renders a mobile dropdown trigger with the active tab label", () => {
    render(<TabBar />);
    const trigger = screen.getByRole("button", {
      name: /Dashboard navigation/,
    });
    expect(trigger).toBeTruthy();
    expect(trigger.textContent).toContain("Runs");
  });
});
