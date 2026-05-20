import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { curator } from "./curator";

describe("curator skill", () => {
  it("has the expected id and budget", () => {
    expect(curator.id).toBe("curator");
    expect(curator.budget).toBe(1.0);
    expect(curator.stalenessThresholdMs).toBe(300_000);
  });

  it("exposes the 9-tool whitelist", () => {
    expect(curator.toolNames).toEqual([
      "vault.page.read",
      "vault.tree.list",
      "vault.search",
      "vault.backlinks",
      "vault.inbox.list",
      "vault.inbox.item",
      "vault.inbox.commit",
      "vault.inbox.discard",
      "lint.run",
    ]);
  });

  it("does NOT expose vault.inbox.promote (Curator is the proposer)", () => {
    expect(curator.toolNames).not.toContain("vault.inbox.promote");
  });

  it("substitutes today, last-run, budget into user prompt", () => {
    const prompt = curator.userPrompt({
      todayIso:   "2026-05-19",
      lastRunIso: "2026-05-18",
      budget:     1.0,
    });
    expect(prompt).toContain("2026-05-19");
    expect(prompt).toContain("2026-05-18");
    expect(prompt).toContain("$1");
  });

  it("loads the system prompt from disk", () => {
    expect(curator.systemPrompt).toContain("You are the Curator");
    expect(curator.systemPrompt).toContain("vault.inbox.commit");
  });
});
