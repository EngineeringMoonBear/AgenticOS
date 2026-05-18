import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../../src/parse/frontmatter.js";

describe("parseFrontmatter", () => {
  it("extracts meta and body from a valid frontmatter block", () => {
    const source = `---
title: My Page
tags: [farm, software]
---
# Body starts here
`;
    const { meta, body } = parseFrontmatter(source);
    expect(meta["title"]).toBe("My Page");
    expect(meta["tags"]).toEqual(["farm", "software"]);
    expect(body.trim()).toBe("# Body starts here");
  });

  it("returns empty meta and full source when no frontmatter", () => {
    const source = "# Just a heading\n\nSome text.";
    const { meta, body } = parseFrontmatter(source);
    expect(meta).toEqual({});
    expect(body).toBe(source);
  });

  it("handles empty frontmatter block", () => {
    const source = `---\n---\nBody text`;
    const { meta, body } = parseFrontmatter(source);
    expect(meta).toEqual({});
    expect(body).toBe("Body text");
  });

  it("throws on malformed YAML frontmatter", () => {
    const source = `---\ntitle: [unclosed bracket\n---\nBody`;
    expect(() => parseFrontmatter(source)).toThrow(/malformed/i);
  });

  it("rejects dangerous YAML tags (!!js/function)", () => {
    const source = `---\nfn: !!js/function 'function() { return 1; }'\n---\nBody`;
    expect(() => parseFrontmatter(source)).toThrow(/dangerous/i);
  });

  it("handles frontmatter with CRLF line endings", () => {
    const source = "---\r\ntitle: CRLF Page\r\n---\r\nBody";
    const { meta, body } = parseFrontmatter(source);
    expect(meta["title"]).toBe("CRLF Page");
    expect(body).toBe("Body");
  });
});
