import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  buildInboundDescription,
  buildMirrorOpsMessage,
  getHeader,
  parseGithubAppIssueEvent,
  parseInboundPayload,
  verifyGithubSignature,
  type InboundPayload,
} from "../src/inbound.js";
import { detectGithubMarker } from "../src/sync.js";

const SECRET = "s3cr3t";
const RAW = JSON.stringify({ repo: "o/r", number: 7, title: "t", body: "b", url: "u" });
const SIG = `sha256=${createHmac("sha256", SECRET).update(RAW, "utf8").digest("hex")}`;

describe("verifyGithubSignature", () => {
  it("accepts a correct sha256 HMAC over the raw body", () => {
    expect(verifyGithubSignature(RAW, SECRET, SIG)).toBe(true);
  });
  it("rejects a wrong signature, wrong secret, missing header, or tampered body", () => {
    expect(verifyGithubSignature(RAW, SECRET, "sha256=deadbeef")).toBe(false);
    expect(verifyGithubSignature(RAW, "other", SIG)).toBe(false);
    expect(verifyGithubSignature(RAW, SECRET, undefined)).toBe(false);
    expect(verifyGithubSignature(RAW + " ", SECRET, SIG)).toBe(false);
  });
});

describe("getHeader", () => {
  it("is case-insensitive and unwraps array values", () => {
    expect(getHeader({ "X-Hub-Signature-256": "z" }, "x-hub-signature-256")).toBe("z");
    expect(getHeader({ "x-hub-signature-256": ["a", "b"] }, "X-Hub-Signature-256")).toBe("a");
    expect(getHeader({}, "x-hub-signature-256")).toBeUndefined();
  });
});

describe("parseInboundPayload", () => {
  it("parses a valid payload (number as int or string)", () => {
    expect(parseInboundPayload({ repo: "o/r", number: 7, title: "t", body: "b", url: "u" })).toEqual({
      repo: "o/r",
      number: 7,
      title: "t",
      body: "b",
      url: "u",
    });
    expect(parseInboundPayload({ repo: "o/r", number: "42", title: "t" })?.number).toBe(42);
  });
  it("rejects missing repo/title or a non-positive number", () => {
    expect(parseInboundPayload({ number: 7, title: "t" })).toBeNull();
    expect(parseInboundPayload({ repo: "o/r", number: 7 })).toBeNull();
    expect(parseInboundPayload({ repo: "o/r", number: 0, title: "t" })).toBeNull();
    expect(parseInboundPayload("nope")).toBeNull();
  });
});

describe("parseGithubAppIssueEvent", () => {
  const event = (over: Record<string, unknown> = {}) => ({
    action: "opened",
    repository: { full_name: "Goldberry-Playground/odoocker-goldberrygrove" },
    issue: {
      number: 42,
      title: "Bug: cart 500s",
      body: "steps...",
      html_url: "https://github.com/Goldberry-Playground/odoocker-goldberrygrove/issues/42",
      labels: [{ name: "bug" }, { name: "synced-from-paperclip" }],
    },
    ...over,
  });

  it("maps a native issues payload to InboundPayload + action + labels", () => {
    const parsed = parseGithubAppIssueEvent(event());
    expect(parsed?.action).toBe("opened");
    expect(parsed?.labels).toEqual(["bug", "synced-from-paperclip"]);
    expect(parsed?.payload).toEqual({
      repo: "Goldberry-Playground/odoocker-goldberrygrove",
      number: 42,
      title: "Bug: cart 500s",
      body: "steps...",
      url: "https://github.com/Goldberry-Playground/odoocker-goldberrygrove/issues/42",
    });
  });

  it("preserves non-opened actions (caller decides to skip)", () => {
    expect(parseGithubAppIssueEvent(event({ action: "edited" }))?.action).toBe("edited");
  });

  it("tolerates string-valued labels and a missing labels array", () => {
    expect(parseGithubAppIssueEvent(event({ issue: { number: 1, title: "t", labels: ["x"] } }))?.labels).toEqual(["x"]);
    expect(parseGithubAppIssueEvent(event({ issue: { number: 1, title: "t" } }))?.labels).toEqual([]);
  });

  it("returns null without repository.full_name, title, or a positive number", () => {
    expect(parseGithubAppIssueEvent(event({ repository: {} }))).toBeNull();
    expect(parseGithubAppIssueEvent(event({ issue: { number: 42, title: "" } }))).toBeNull();
    expect(parseGithubAppIssueEvent(event({ issue: { number: 0, title: "t" } }))).toBeNull();
    expect(parseGithubAppIssueEvent("nope")).toBeNull();
  });
});

describe("buildInboundDescription", () => {
  it("embeds a marker that round-trips through detectGithubMarker (loop-prevention contract)", () => {
    const p: InboundPayload = { repo: "EngineeringMoonBear/AgenticOS", number: 123, title: "t", body: "hello", url: "https://x" };
    const desc = buildInboundDescription(p);
    expect(desc).toContain("hello");
    const marker = detectGithubMarker(desc);
    expect(marker).toEqual({ repo: "EngineeringMoonBear/AgenticOS", number: 123 });
  });
});

describe("buildMirrorOpsMessage", () => {
  const base = {
    repo: "EngineeringMoonBear/AgenticOS",
    number: 236,
    title: "CI is flaky",
    url: "https://github.com/EngineeringMoonBear/AgenticOS/issues/236",
    projectId: "proj-1",
    issueId: "iss-1",
  };

  it("names the assignee and the source issue when default routing is configured", () => {
    const msg = buildMirrorOpsMessage({ ...base, assigneeAgentId: "agent-9" });
    expect(msg).toContain("CI is flaky");
    expect(msg).toContain("AgenticOS#236");
    expect(msg).toContain("agent-9");
    expect(msg).toContain("iss-1");
    expect(msg).toContain(base.url);
    expect(msg).not.toContain("UNASSIGNED");
  });

  it("loudly flags an unassigned mirror (the GOL-80 failure mode)", () => {
    const msg = buildMirrorOpsMessage(base);
    expect(msg).toContain("UNASSIGNED");
    expect(msg).toContain("defaultAssigneeAgentId");
  });

  it("omits the link parenthetical when no url is present", () => {
    const msg = buildMirrorOpsMessage({ ...base, url: "", assigneeAgentId: "agent-9" });
    expect(msg).not.toContain("(<");
  });
});
