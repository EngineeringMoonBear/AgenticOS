import { describe, it, expect } from "vitest";
import { classifyPr, type PrFacts } from "../src/classify.js";

const NOW = new Date("2026-06-10T00:00:00Z");

function facts(over: Partial<PrFacts> = {}): PrFacts {
  return {
    repoFullName: "o/r",
    number: 1,
    title: "T",
    author: "a",
    htmlUrl: "u",
    draft: false,
    updatedAt: "2026-06-09T00:00:00Z",
    mergeableState: "clean",
    checksState: "success",
    reviewState: "approved",
    ...over,
  };
}

describe("classifyPr", () => {
  it("ready-to-merge", () => {
    expect(classifyPr(facts(), NOW, 7)).toEqual(["ready-to-merge"]);
  });
  it("ci-failing + needs-review, not ready", () => {
    const b = classifyPr(facts({ checksState: "failure", reviewState: "none" }), NOW, 7);
    expect(b).toContain("ci-failing");
    expect(b).toContain("needs-review");
    expect(b).not.toContain("ready-to-merge");
  });
  it("has-conflicts", () => {
    expect(classifyPr(facts({ mergeableState: "dirty" }), NOW, 7)).toContain("has-conflicts");
  });
  it("stale by updatedAt", () => {
    expect(classifyPr(facts({ updatedAt: "2026-05-01T00:00:00Z" }), NOW, 7)).toContain("stale");
  });
  it("draft excluded from needs-review", () => {
    const b = classifyPr(facts({ draft: true, reviewState: "none" }), NOW, 7);
    expect(b).toContain("draft");
    expect(b).not.toContain("needs-review");
  });
});
