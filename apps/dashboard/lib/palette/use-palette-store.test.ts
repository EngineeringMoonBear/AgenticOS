import { describe, it, expect, beforeEach } from "vitest";
import { usePaletteStore } from "./use-palette-store";

describe("usePaletteStore", () => {
  beforeEach(() => {
    // Reset store state before each test
    usePaletteStore.setState({ isOpen: false });
  });

  it("starts closed", () => {
    expect(usePaletteStore.getState().isOpen).toBe(false);
  });

  it("open() sets isOpen to true", () => {
    usePaletteStore.getState().open();
    expect(usePaletteStore.getState().isOpen).toBe(true);
  });

  it("close() sets isOpen to false", () => {
    usePaletteStore.setState({ isOpen: true });
    usePaletteStore.getState().close();
    expect(usePaletteStore.getState().isOpen).toBe(false);
  });

  it("toggle() flips false → true", () => {
    usePaletteStore.getState().toggle();
    expect(usePaletteStore.getState().isOpen).toBe(true);
  });

  it("toggle() flips true → false", () => {
    usePaletteStore.setState({ isOpen: true });
    usePaletteStore.getState().toggle();
    expect(usePaletteStore.getState().isOpen).toBe(false);
  });
});
