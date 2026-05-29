import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { IconBtn } from "./IconBtn";

describe("IconBtn", () => {
  it("renders a button with the provided aria-label and children", () => {
    render(
      <IconBtn ariaLabel="Cancel run">
        <svg data-testid="ico" />
      </IconBtn>,
    );
    const btn = screen.getByRole("button", { name: "Cancel run" });
    expect(btn.getAttribute("aria-label")).toBe("Cancel run");
    expect(btn.className).toContain("icon-btn");
    expect(screen.getByTestId("ico")).toBeDefined();
  });

  it.each([
    ["alert", "alert"],
    ["go", "go"],
  ] as const)("applies %s variant class", (variant, expected) => {
    render(
      <IconBtn variant={variant} ariaLabel={`${variant} action`}>
        <svg />
      </IconBtn>,
    );
    expect(
      screen.getByRole("button", { name: `${variant} action` }).className,
    ).toContain(expected);
  });

  it("does not add variant class for default variant", () => {
    render(
      <IconBtn ariaLabel="default">
        <svg />
      </IconBtn>,
    );
    const btn = screen.getByRole("button", { name: "default" });
    expect(btn.className).not.toMatch(/\balert\b/);
    expect(btn.className).not.toMatch(/\bgo\b/);
  });

  it("fires onClick", () => {
    const onClick = vi.fn();
    render(
      <IconBtn ariaLabel="Go" onClick={onClick}>
        <svg />
      </IconBtn>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
