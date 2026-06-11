import { describe, it, expect } from "vitest";
import { renderDigest, type AssessedPr } from "../src/render.js";

const NOW = new Date("2026-06-10T00:00:00Z");

const assessed: AssessedPr[] = [
  {
    repoFullName: "o/r", number: 1, title: "Broken", author: "a",
    htmlUrl: "u1", updatedAt: "2026-06-09T00:00:00Z",
    buckets: ["ci-failing", "needs-review"],
  },
  {
    repoFullName: "o/r", number: 2, title: "Done", author: "b",
    htmlUrl: "u2", updatedAt: "2026-06-09T00:00:00Z",
    buckets: ["ready-to-merge"],
  },
];

describe("renderDigest", () => {
  it("has a title, attention section, table, and front matter", () => {
    const md = renderDigest(assessed, NOW, []);
    expect(md).toContain("# Dev PR Triage");
    expect(md).toContain("generated_at:");
    expect(md).toContain("Needs your attention");
    expect(md).toContain("Broken");
    expect(md).toContain("Done");
    expect(md).toContain("o/r");
  });
  it("renders an errors footer when present", () => {
    const md = renderDigest([], NOW, ["o/x#3: boom"]);
    expect(md).toContain("Errors");
    expect(md).toContain("o/x#3: boom");
  });
});
