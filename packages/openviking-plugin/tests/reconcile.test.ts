import { describe, it, expect } from "vitest";
import { diff } from "../src/ingest/reconcile.js";
import type { VaultFile } from "../src/ingest/reconcile.js";

// Fixtures
const makeFile = (path: string, sha256: string, content = ""): VaultFile => ({
  path,
  content,
  sha256,
});

describe("diff", () => {
  it("returns a new file as add when path is not in prior", () => {
    const current = [makeFile("notes/hello.md", "aaaa")];
    const prior = new Map<string, string>();

    const result = diff(current, prior);

    expect(result.add).toHaveLength(1);
    expect(result.add[0]?.path).toBe("notes/hello.md");
    expect(result.update).toHaveLength(0);
    expect(result.remove).toHaveLength(0);
  });

  it("returns a changed file as update when sha differs", () => {
    const current = [makeFile("notes/hello.md", "bbbb")];
    const prior = new Map([["notes/hello.md", "aaaa"]]);

    const result = diff(current, prior);

    expect(result.add).toHaveLength(0);
    expect(result.update).toHaveLength(1);
    expect(result.update[0]?.path).toBe("notes/hello.md");
    expect(result.update[0]?.sha256).toBe("bbbb");
    expect(result.remove).toHaveLength(0);
  });

  it("omits unchanged files (same path and sha)", () => {
    const current = [makeFile("notes/stable.md", "cccc")];
    const prior = new Map([["notes/stable.md", "cccc"]]);

    const result = diff(current, prior);

    expect(result.add).toHaveLength(0);
    expect(result.update).toHaveLength(0);
    expect(result.remove).toHaveLength(0);
  });

  it("returns paths in prior but not current as remove", () => {
    const current: VaultFile[] = [];
    const prior = new Map([["notes/gone.md", "dddd"]]);

    const result = diff(current, prior);

    expect(result.add).toHaveLength(0);
    expect(result.update).toHaveLength(0);
    expect(result.remove).toHaveLength(1);
    expect(result.remove[0]).toBe("notes/gone.md");
  });

  it("handles a mixed batch correctly", () => {
    const current = [
      makeFile("farming/plan.md", "new-sha"),   // add
      makeFile("notes/changed.md", "new2"),      // update
      makeFile("notes/stable.md", "same"),       // unchanged
    ];
    const prior = new Map([
      ["notes/changed.md", "old2"],
      ["notes/stable.md", "same"],
      ["notes/deleted.md", "old3"],
    ]);

    const result = diff(current, prior);

    expect(result.add.map((f) => f.path)).toEqual(["farming/plan.md"]);
    expect(result.update.map((f) => f.path)).toEqual(["notes/changed.md"]);
    expect(result.remove).toEqual(["notes/deleted.md"]);
  });

  it("returns empty result for empty inputs", () => {
    const result = diff([], new Map());
    expect(result.add).toHaveLength(0);
    expect(result.update).toHaveLength(0);
    expect(result.remove).toHaveLength(0);
  });
});
