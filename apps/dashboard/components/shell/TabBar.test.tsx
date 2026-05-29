import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/live",
}));

import { TabBar } from "./TabBar";

describe("TabBar", () => {
  it("marks the active tab with aria-selected=true", () => {
    render(<TabBar />);
    const liveTab = screen.getByRole("tab", { name: "Live Ops" });
    const memoryTab = screen.getByRole("tab", { name: "Memory" });
    expect(liveTab.getAttribute("aria-selected")).toBe("true");
    expect(memoryTab.getAttribute("aria-selected")).toBe("false");
  });

  it("renders both tabs as links", () => {
    render(<TabBar />);
    expect(screen.getByRole("tab", { name: "Live Ops" }).getAttribute("href")).toBe("/live");
    expect(screen.getByRole("tab", { name: "Memory" }).getAttribute("href")).toBe("/memory");
  });
});
