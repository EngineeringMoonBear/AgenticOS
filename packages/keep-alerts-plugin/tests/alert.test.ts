import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  buildIssueDescription,
  buildRecurrenceComment,
  buildRefireComment,
  buildResolutionComment,
  getHeader,
  keepMarker,
  normalizeSeverity,
  parseKeepAlert,
  resolveOwnership,
  routingTokens,
  severityToPriority,
  shouldMint,
  verifyKeepSignature,
  DEFAULT_MINT_SEVERITIES,
  type KeepAlert,
} from "../src/alert.js";

const SECRET = "s3cr3t";
const RAW = JSON.stringify({ fingerprint: "fp-1", name: "Disk full", severity: "critical", status: "firing" });
const SIG = `sha256=${createHmac("sha256", SECRET).update(RAW, "utf8").digest("hex")}`;

describe("verifyKeepSignature", () => {
  it("accepts a correct sha256 HMAC over the raw body", () => {
    expect(verifyKeepSignature(RAW, SECRET, SIG)).toBe(true);
  });
  it("rejects a wrong signature, wrong secret, missing header, or tampered body", () => {
    expect(verifyKeepSignature(RAW, SECRET, "sha256=deadbeef")).toBe(false);
    expect(verifyKeepSignature(RAW, "other", SIG)).toBe(false);
    expect(verifyKeepSignature(RAW, SECRET, undefined)).toBe(false);
    expect(verifyKeepSignature(RAW + " ", SECRET, SIG)).toBe(false);
  });
});

describe("getHeader", () => {
  it("is case-insensitive and unwraps array values", () => {
    expect(getHeader({ "X-Hub-Signature-256": "z" }, "x-hub-signature-256")).toBe("z");
    expect(getHeader({ "x-hub-signature-256": ["a", "b"] }, "X-Hub-Signature-256")).toBe("a");
    expect(getHeader({}, "x-hub-signature-256")).toBeUndefined();
  });
});

describe("normalizeSeverity", () => {
  it("passes through known severities (case-insensitive) and defaults unknown to warning", () => {
    expect(normalizeSeverity("CRITICAL")).toBe("critical");
    expect(normalizeSeverity("info")).toBe("info");
    expect(normalizeSeverity("bogus")).toBe("warning");
    expect(normalizeSeverity(undefined)).toBe("warning");
  });
});

describe("severityToPriority", () => {
  it("maps Keep severity onto Paperclip priority", () => {
    expect(severityToPriority("critical")).toBe("critical");
    expect(severityToPriority("high")).toBe("high");
    expect(severityToPriority("warning")).toBe("medium");
    expect(severityToPriority("info")).toBe("low");
    expect(severityToPriority("low")).toBe("low");
  });
});

describe("shouldMint / default gate", () => {
  it("mints critical/high/warning and skips info/low by default", () => {
    expect(shouldMint("critical", DEFAULT_MINT_SEVERITIES)).toBe(true);
    expect(shouldMint("high", DEFAULT_MINT_SEVERITIES)).toBe(true);
    expect(shouldMint("warning", DEFAULT_MINT_SEVERITIES)).toBe(true);
    expect(shouldMint("info", DEFAULT_MINT_SEVERITIES)).toBe(false);
    expect(shouldMint("low", DEFAULT_MINT_SEVERITIES)).toBe(false);
  });
  it("honours a custom gate", () => {
    expect(shouldMint("info", ["info"])).toBe(true);
    expect(shouldMint("critical", ["info"])).toBe(false);
  });
});

describe("parseKeepAlert", () => {
  it("parses a full alert and normalises severity + resolved flag", () => {
    const a = parseKeepAlert({
      fingerprint: "fp-1",
      name: "Disk full",
      severity: "CRITICAL",
      status: "firing",
      description: "root partition at 98%",
      source: ["prometheus"],
      service: "odoocker",
      environment: "prod",
      url: "https://keep/alert/1",
      labels: { repo: "odoocker", team: "infra" },
    });
    expect(a).toMatchObject({
      fingerprint: "fp-1",
      name: "Disk full",
      severity: "critical",
      resolved: false,
      source: ["prometheus"],
      labels: { repo: "odoocker", team: "infra" },
    });
  });
  it("accepts `title` for name and `generatorURL` for url; string source coerced to array", () => {
    const a = parseKeepAlert({ fingerprint: "fp", title: "T", source: "grafana", generatorURL: "u", status: "resolved" });
    expect(a?.name).toBe("T");
    expect(a?.url).toBe("u");
    expect(a?.source).toEqual(["grafana"]);
    expect(a?.resolved).toBe(true);
  });
  it("rejects payloads missing fingerprint or name", () => {
    expect(parseKeepAlert({ name: "x" })).toBeNull();
    expect(parseKeepAlert({ fingerprint: "fp" })).toBeNull();
    expect(parseKeepAlert(null)).toBeNull();
    expect(parseKeepAlert("nope")).toBeNull();
  });
});

const ALERT: KeepAlert = {
  fingerprint: "fp-1",
  name: "Disk full",
  severity: "critical",
  resolved: false,
  status: "firing",
  description: "root partition at 98%",
  source: ["prometheus"],
  service: "odoocker",
  environment: "prod",
  url: "https://keep/alert/1",
  labels: { repo: "odoocker", team: "infra" },
};

describe("routing", () => {
  it("routingTokens includes source/service/env/name/labels lowercased", () => {
    const t = routingTokens(ALERT);
    expect(t).toContain("prometheus");
    expect(t).toContain("odoocker");
    expect(t).toContain("team=infra");
    expect(t).toContain("disk full");
  });
  it("resolveOwnership picks the first matching rule (case-insensitive substring)", () => {
    const rules = [
      { match: "no-match", assigneeAgentId: "A" },
      { match: "INFRA", assigneeAgentId: "devops", projectId: "proj-infra" },
      { match: "odoocker", assigneeAgentId: "second" },
    ];
    const r = resolveOwnership(ALERT, rules);
    expect(r.assigneeAgentId).toBe("devops");
    expect(r.projectId).toBe("proj-infra");
    expect(r.matchedBy).toBe("INFRA");
  });
  it("resolveOwnership returns empty when no rule matches", () => {
    expect(resolveOwnership(ALERT, [{ match: "nope", assigneeAgentId: "A" }])).toEqual({});
  });
});

describe("message builders", () => {
  it("description embeds the fingerprint marker and key fields", () => {
    const d = buildIssueDescription(ALERT);
    expect(d).toContain(keepMarker("fp-1"));
    expect(d).toContain("Disk full");
    expect(d).toContain("critical");
    expect(d).toContain("root partition at 98%");
    expect(d).toContain("`team`: infra");
  });
  it("re-fire / recurrence / resolution comments read distinctly", () => {
    expect(buildRefireComment(ALERT, 3)).toContain("re-fired");
    expect(buildRefireComment(ALERT, 3)).toContain("#3");
    expect(buildRecurrenceComment(ALERT, 4)).toContain("recurred after resolution");
    expect(buildResolutionComment(ALERT, 5)).toContain("resolved");
    expect(buildResolutionComment(ALERT, 5)).toContain("5 occurrences");
    expect(buildResolutionComment(ALERT, 1)).toContain("1 occurrence");
  });
});
