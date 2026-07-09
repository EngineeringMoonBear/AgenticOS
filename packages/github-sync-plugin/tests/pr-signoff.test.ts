import { describe, it, expect } from "vitest";
import { evaluateSignoff } from "../src/pr-signoff.js";
import type { PrReviewRow } from "../src/pr-review-store.js";

const row = (reviewer: string, headSha = "abc123", prNumber = 7): PrReviewRow => ({
  githubRepo: "AgenticOS",
  prNumber,
  reviewer,
  headSha,
  paperclipIssueId: `iss-${reviewer}`,
  updatedAt: "2026-07-09T00:00:00.000Z",
});

describe("evaluateSignoff — required-alice gate (GOL-186)", () => {
  it("alice-only PR: alice done → alice green", () => {
    const actions = evaluateSignoff({ alice: { row: row("alice"), done: true }, iris: null });
    expect(actions.map((a) => a.reviewer)).toEqual(["alice"]);
  });

  it("alice-only PR: alice not done → nothing", () => {
    const actions = evaluateSignoff({ alice: { row: row("alice"), done: false }, iris: null });
    expect(actions).toEqual([]);
  });

  it("frontend PR: alice done but iris pending → iris NOT green, alice held (fail-closed)", () => {
    const actions = evaluateSignoff({
      alice: { row: row("alice"), done: true },
      iris: { row: row("iris"), done: false },
    });
    expect(actions).toEqual([]);
  });

  it("frontend PR: iris done first, alice pending → iris green, alice held", () => {
    const actions = evaluateSignoff({
      alice: { row: row("alice"), done: false },
      iris: { row: row("iris"), done: true },
    });
    expect(actions.map((a) => a.reviewer)).toEqual(["iris"]);
  });

  it("frontend PR: both done → iris green + alice green (either order converges)", () => {
    const actions = evaluateSignoff({
      alice: { row: row("alice"), done: true },
      iris: { row: row("iris"), done: true },
    });
    expect(actions.map((a) => a.reviewer).sort()).toEqual(["alice", "iris"]);
  });

  it("mid-synchronize race: rows on different head SHAs → alice held even if both done", () => {
    const actions = evaluateSignoff({
      alice: { row: row("alice", "newsha"), done: true },
      iris: { row: row("iris", "oldsha"), done: true },
    });
    // iris still greens on its own head, but alice is held until heads align
    expect(actions.map((a) => a.reviewer)).toEqual(["iris"]);
  });

  it("carries the head SHA + PR number of the reviewer's row", () => {
    const [action] = evaluateSignoff({ alice: { row: row("alice", "deadbeef", 42), done: true }, iris: null });
    expect(action).toMatchObject({ reviewer: "alice", headSha: "deadbeef", prNumber: 42 });
  });
});
