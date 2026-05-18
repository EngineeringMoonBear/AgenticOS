import { describe, it, expect } from "vitest";
import { detectTodos } from "../../src/lint/todos.js";
import type { VaultIndex, WikiPage } from "../../src/types.js";
import type { Root } from "mdast";

const emptyAst: Root = { type: "root", children: [] };

function makePageWithBody(p: string, body: string): WikiPage {
  return {
    path: p,
    title: p,
    tags: [],
    created: "",
    updated: "",
    sources: [],
    body,
    bodyAst: emptyAst,
    outgoing: [],
    unresolvedLinks: [],
  };
}

function makeIndex(pages: Map<string, WikiPage>): VaultIndex {
  return { pages, backlinks: new Map(), allTags: new Set(), builtAt: Date.now() };
}

describe("detectTodos", () => {
  it("detects TODO markers", () => {
    const pages = new Map([
      ["Note", makePageWithBody("Note", "Some text\nTODO: fix this\nMore text")],
    ]);
    const issues = detectTodos(makeIndex(pages));
    expect(issues.some((i) => i.kind === "todo" && i.detail.includes("TODO"))).toBe(true);
  });

  it("detects FIXME markers", () => {
    const pages = new Map([
      ["Note", makePageWithBody("Note", "FIXME: this is broken")],
    ]);
    const issues = detectTodos(makeIndex(pages));
    expect(issues[0]!.kind).toBe("todo");
    expect(issues[0]!.detail).toContain("FIXME");
  });

  it("detects [[?]] markers", () => {
    const pages = new Map([
      ["Note", makePageWithBody("Note", "Is [[?]] the right approach?")],
    ]);
    const issues = detectTodos(makeIndex(pages));
    expect(issues[0]!.kind).toBe("todo");
  });

  it("detects unchecked task list items", () => {
    const pages = new Map([
      ["Tasks", makePageWithBody("Tasks", "- [ ] An unchecked task\n- [x] Done task")],
    ]);
    const issues = detectTodos(makeIndex(pages));
    expect(issues.some((i) => i.detail.includes("unchecked task"))).toBe(true);
    // Completed tasks should not be flagged
    expect(issues.some((i) => i.detail.includes("Done task"))).toBe(false);
  });

  it("reports the correct 1-based line number", () => {
    const body = "Line one\nLine two\nTODO: on line three\nLine four";
    const pages = new Map([["P", makePageWithBody("P", body)]]);
    const issues = detectTodos(makeIndex(pages));
    expect(issues[0]!.line).toBe(3);
  });

  it("returns empty array when no todos exist", () => {
    const pages = new Map([
      ["Clean", makePageWithBody("Clean", "This is a clean note.")],
    ]);
    expect(detectTodos(makeIndex(pages))).toHaveLength(0);
  });
});
