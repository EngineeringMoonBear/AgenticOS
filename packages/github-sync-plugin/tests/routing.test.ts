import { describe, it, expect } from "vitest";
import { resolveRouting, type RoutingInput } from "../src/routing.js";

// The four discipline owners from the spec (agent ids are placeholders here).
const IRIS = "iris-id";
const ALICE = "alice-id";
const TERRA = "terra-id";
const RICK = "rick-id";

const ROUTING: RoutingInput = {
  labelRouting: {
    frontend: IRIS,
    feature: ALICE,
    bug: TERRA,
    infra: TERRA,
    alert: TERRA,
  },
  fallbackAssigneeAgentId: RICK,
};

describe("resolveRouting — single-label routing", () => {
  it("routes frontend → Iris", () => {
    const r = resolveRouting(ROUTING, ["frontend"]);
    expect(r).toEqual({ assigneeAgentId: IRIS, matchedLabel: "frontend", reason: "label" });
  });
  it("routes feature → Alice", () => {
    expect(resolveRouting(ROUTING, ["feature"]).assigneeAgentId).toBe(ALICE);
  });
  it("routes bug/infra/alert → Terra", () => {
    expect(resolveRouting(ROUTING, ["bug"]).assigneeAgentId).toBe(TERRA);
    expect(resolveRouting(ROUTING, ["infra"]).assigneeAgentId).toBe(TERRA);
    expect(resolveRouting(ROUTING, ["alert"]).assigneeAgentId).toBe(TERRA);
  });
});

describe("resolveRouting — precedence (infra=bug=alert > frontend > feature)", () => {
  it("infra beats frontend and feature", () => {
    const r = resolveRouting(ROUTING, ["feature", "frontend", "infra"]);
    expect(r.assigneeAgentId).toBe(TERRA);
    expect(r.matchedLabel).toBe("infra");
  });
  it("bug beats frontend", () => {
    expect(resolveRouting(ROUTING, ["frontend", "bug"]).assigneeAgentId).toBe(TERRA);
  });
  it("frontend beats feature", () => {
    const r = resolveRouting(ROUTING, ["feature", "frontend"]);
    expect(r.assigneeAgentId).toBe(IRIS);
    expect(r.matchedLabel).toBe("frontend");
  });
  it("is case-insensitive on label names", () => {
    expect(resolveRouting(ROUTING, ["FrontEnd"]).assigneeAgentId).toBe(IRIS);
  });
});

describe("resolveRouting — fallback + backward compatibility", () => {
  it("unlabeled → fallback (Rick triage)", () => {
    expect(resolveRouting(ROUTING, [])).toEqual({ assigneeAgentId: RICK, reason: "fallback" });
  });
  it("unmatched labels → fallback", () => {
    expect(resolveRouting(ROUTING, ["docs", "chore"]).assigneeAgentId).toBe(RICK);
  });
  it("labelRouting takes precedence over fallback when a label matches", () => {
    expect(resolveRouting(ROUTING, ["docs", "feature"]).assigneeAgentId).toBe(ALICE);
  });
  it("falls back to defaultAssigneeAgentId when no labelRouting/fallback configured (pre-v0.6.0 config)", () => {
    const legacy: RoutingInput = { defaultAssigneeAgentId: "legacy-owner" };
    expect(resolveRouting(legacy, ["frontend"])).toEqual({
      assigneeAgentId: "legacy-owner",
      reason: "default",
    });
  });
  it("prefers fallback over default when both set and no label matches", () => {
    const both: RoutingInput = { fallbackAssigneeAgentId: RICK, defaultAssigneeAgentId: "legacy" };
    expect(resolveRouting(both, []).assigneeAgentId).toBe(RICK);
  });
  it("returns reason 'none' with no assignee when nothing is configured", () => {
    expect(resolveRouting({}, ["frontend"])).toEqual({ reason: "none" });
  });
});
