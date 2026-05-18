import { describe, it, expect } from "vitest";
import { extractTags, mergeTags } from "../../src/parse/tags.js";

describe("extractTags", () => {
  it("extracts a single inline tag", () => {
    expect(extractTags("This is about #farm life.")).toContain("farm");
  });

  it("extracts multiple distinct tags", () => {
    const tags = extractTags("Topics: #farm and #software for #concepts");
    expect(tags).toContain("farm");
    expect(tags).toContain("software");
    expect(tags).toContain("concepts");
  });

  it("deduplicates repeated tags", () => {
    const tags = extractTags("#farm and #farm again");
    expect(tags.filter((t) => t === "farm")).toHaveLength(1);
  });

  it("ignores tags inside code fences", () => {
    const body = "```\n#farm is a code string\n```\nReal text #farm here";
    const tags = extractTags(body);
    // Should only match one farm (after code fence is stripped), NOT two
    expect(tags.filter((t) => t === "farm")).toHaveLength(1);
  });

  it("ignores tags inside inline code spans", () => {
    const body = "Use `#tag-in-code` sparingly. Real #software tag here.";
    const tags = extractTags(body);
    expect(tags).not.toContain("tag-in-code");
    expect(tags).toContain("software");
  });

  it("ignores URL fragments (http://example.com#anchor)", () => {
    // URL # should be preceded by non-word chars that disqualify it via the lookbehind
    const body = "See http://example.com#section for info.";
    const tags = extractTags(body);
    expect(tags).not.toContain("section");
  });

  it("rejects tags starting with a digit", () => {
    const tags = extractTags("Invalid #1tag here");
    expect(tags).not.toContain("1tag");
  });

  it("allows hyphens in tag names", () => {
    const tags = extractTags("See #my-tag for this");
    expect(tags).toContain("my-tag");
  });
});

describe("mergeTags", () => {
  it("merges two tag arrays and deduplicates", () => {
    const merged = mergeTags(["farm", "software"], ["software", "concepts"]);
    expect(merged).toEqual(["farm", "software", "concepts"]);
  });

  it("preserves order (a first, then new from b)", () => {
    const merged = mergeTags(["a", "b"], ["c", "a"]);
    expect(merged).toEqual(["a", "b", "c"]);
  });
});
