import { describe, it, expect } from "vitest";
import { detectOrphans } from "../../src/lint/orphans.js";
import type { VaultIndex, WikiPage } from "../../src/types.js";
import type { Root } from "mdast";

const emptyAst: Root = { type: "root", children: [] };

function makePage(p: string, outgoing: string[] = []): WikiPage {
  return {
    path: p,
    title: p,
    tags: [],
    created: "",
    updated: "",
    sources: [],
    body: "",
    bodyAst: emptyAst,
    outgoing,
    unresolvedLinks: [],
  };
}

function makeIndex(
  pages: Map<string, WikiPage>,
  backlinks: Map<string, string[]> = new Map()
): VaultIndex {
  return { pages, backlinks, allTags: new Set(), builtAt: Date.now() };
}

describe("detectOrphans", () => {
  it("detects a page with no incoming and no outgoing links", () => {
    const pages = new Map([["Orphan", makePage("Orphan")]]);
    const issues = detectOrphans(makeIndex(pages));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe("orphan");
    expect(issues[0]!.path).toBe("Orphan");
  });

  it("does NOT flag a page that has outgoing links", () => {
    const pages = new Map([["HasLinks", makePage("HasLinks", ["Other"])]]);
    const issues = detectOrphans(makeIndex(pages));
    expect(issues).toHaveLength(0);
  });

  it("does NOT flag a page that has incoming links", () => {
    const pages = new Map([["Target", makePage("Target")]]);
    const backlinks = new Map([["Target", ["SomePage"]]]);
    const issues = detectOrphans(makeIndex(pages, backlinks));
    expect(issues).toHaveLength(0);
  });

  it("skips pages under _meta/", () => {
    const pages = new Map([["_meta/config", makePage("_meta/config")]]);
    const issues = detectOrphans(makeIndex(pages));
    expect(issues).toHaveLength(0);
  });

  it("skips pages with path starting with _meta/", () => {
    const pages = new Map([
      ["_meta/README", makePage("_meta/README")],
      ["Orphan", makePage("Orphan")],
    ]);
    const issues = detectOrphans(makeIndex(pages));
    expect(issues.some((i) => i.path === "_meta/README")).toBe(false);
    expect(issues.some((i) => i.path === "Orphan")).toBe(true);
  });
});
