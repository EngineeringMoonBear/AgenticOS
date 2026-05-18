import { describe, it, expect } from "vitest";
import {
  extractWikilinks,
  resolveWikilinks,
} from "../../src/parse/wikilinks.js";

describe("extractWikilinks", () => {
  it("extracts plain wikilink references", () => {
    const refs = extractWikilinks("See [[Farm/Plot A12]] for details.");
    expect(refs).toHaveLength(1);
    expect(refs[0]!.raw).toBe("Farm/Plot A12");
    expect(refs[0]!.alias).toBeUndefined();
  });

  it("extracts aliased wikilink references", () => {
    const refs = extractWikilinks("See [[Farm/Plot A12|the plot]] today.");
    expect(refs).toHaveLength(1);
    expect(refs[0]!.raw).toBe("Farm/Plot A12");
    expect(refs[0]!.alias).toBe("the plot");
  });

  it("deduplicates identical refs", () => {
    const refs = extractWikilinks("[[Note A]] and [[Note A]] again");
    expect(refs).toHaveLength(1);
  });

  it("does NOT extract embed syntax ![[...]]", () => {
    const refs = extractWikilinks("![[embedded-image.png]] is an embed");
    expect(refs).toHaveLength(0);
  });

  it("extracts multiple distinct refs", () => {
    const refs = extractWikilinks("[[A]] [[B]] [[A|alias]]");
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.raw)).toContain("A");
    expect(refs.map((r) => r.raw)).toContain("B");
  });
});

describe("resolveWikilinks", () => {
  const knownPaths = ["Farm/Plot A12", "Software/TypeScript Notes", "Concepts/NFC"];

  it("resolves by exact path", () => {
    const refs = extractWikilinks("[[Farm/Plot A12]]");
    const { resolved, unresolved } = resolveWikilinks(refs, knownPaths);
    expect(resolved).toContain("Farm/Plot A12");
    expect(unresolved).toHaveLength(0);
  });

  it("resolves by basename when exact path not matched", () => {
    const refs = extractWikilinks("[[TypeScript Notes]]");
    const { resolved, unresolved } = resolveWikilinks(refs, knownPaths);
    expect(resolved).toContain("Software/TypeScript Notes");
    expect(unresolved).toHaveLength(0);
  });

  it("marks truly unresolved refs", () => {
    const refs = extractWikilinks("[[Nonexistent Page]]");
    const { resolved, unresolved } = resolveWikilinks(refs, knownPaths);
    expect(resolved).toHaveLength(0);
    expect(unresolved).toContain("Nonexistent Page");
  });

  it("strips .md extension when resolving exact paths", () => {
    const refs = extractWikilinks("[[Farm/Plot A12.md]]");
    const { resolved, unresolved } = resolveWikilinks(refs, knownPaths);
    expect(resolved).toContain("Farm/Plot A12");
    expect(unresolved).toHaveLength(0);
  });
});
