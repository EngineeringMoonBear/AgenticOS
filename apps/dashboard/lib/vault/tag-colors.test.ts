import { describe, it, expect } from "vitest";
import { colorForTag, TAG_COLORS } from "./tag-colors";

describe("colorForTag", () => {
  it("returns the correct color for a known tag", () => {
    expect(colorForTag("farm")).toBe("#7fae5c");
    expect(colorForTag("software")).toBe("#8c6bce");
    expect(colorForTag("marketing")).toBe("#c9a227");
    expect(colorForTag("video")).toBe("#d97c3f");
    expect(colorForTag("concepts")).toBe("#8aa0c4");
    expect(colorForTag("personal")).toBe("#c47fae");
  });

  it("is case-insensitive", () => {
    expect(colorForTag("Farm")).toBe("#7fae5c");
    expect(colorForTag("SOFTWARE")).toBe("#8c6bce");
    expect(colorForTag("Marketing")).toBe("#c9a227");
  });

  it("returns the default color for an unknown tag", () => {
    expect(colorForTag("unknown")).toBe("#6b6157");
    expect(colorForTag("randomtag")).toBe("#6b6157");
  });

  it("returns the default color for undefined", () => {
    expect(colorForTag(undefined)).toBe("#6b6157");
  });

  it("returns the default color for an empty string", () => {
    // empty string lowercases to "" which has no mapping
    expect(colorForTag("")).toBe("#6b6157");
  });

  it("TAG_COLORS covers all expected keys", () => {
    const expectedKeys = ["farm", "software", "marketing", "video", "concepts", "personal"];
    for (const key of expectedKeys) {
      expect(TAG_COLORS).toHaveProperty(key);
    }
  });
});
