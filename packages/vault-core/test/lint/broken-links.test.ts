import { describe, it, expect } from "vitest";
import { detectBrokenLinks } from "../../src/lint/broken-links.js";
import type { VaultIndex, WikiPage } from "../../src/types.js";
import type { Root } from "mdast";

const emptyAst: Root = { type: "root", children: [] };

function makeIndex(overrides: Partial<VaultIndex> = {}): VaultIndex {
  return {
    pages: new Map(),
    backlinks: new Map(),
    allTags: new Set(),
    builtAt: Date.now(),
    ...overrides,
  };
}

function makePage(path: string, unresolvedLinks: string[] = []): WikiPage {
  return {
    path,
    title: path,
    tags: [],
    created: "",
    updated: "",
    sources: [],
    body: "",
    bodyAst: emptyAst,
    outgoing: [],
    unresolvedLinks,
  };
}

describe("detectBrokenLinks", () => {
  it("returns empty array when no pages have unresolved links", () => {
    const index = makeIndex({
      pages: new Map([["Farm/Plot", makePage("Farm/Plot")]]),
    });
    expect(detectBrokenLinks(index)).toHaveLength(0);
  });

  it("emits one issue per unresolved link", () => {
    const page = makePage("Farm/Plot", ["Missing Page", "Another Missing"]);
    const index = makeIndex({ pages: new Map([["Farm/Plot", page]]) });
    const issues = detectBrokenLinks(index);
    expect(issues).toHaveLength(2);
    expect(issues[0]!.kind).toBe("broken-link");
    expect(issues[0]!.path).toBe("Farm/Plot");
    expect(issues[0]!.detail).toContain("Missing Page");
  });

  it("reports the correct page path in each issue", () => {
    const pages = new Map([
      ["A", makePage("A", ["BrokenRef"])],
      ["B", makePage("B", [])],
    ]);
    const issues = detectBrokenLinks(makeIndex({ pages }));
    expect(issues.every((i) => i.path === "A")).toBe(true);
  });
});
