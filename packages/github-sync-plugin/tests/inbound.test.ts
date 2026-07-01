import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  buildInboundDescription,
  getHeader,
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

describe("buildInboundDescription", () => {
  it("embeds a marker that round-trips through detectGithubMarker (loop-prevention contract)", () => {
    const p: InboundPayload = { repo: "EngineeringMoonBear/AgenticOS", number: 123, title: "t", body: "hello", url: "https://x" };
    const desc = buildInboundDescription(p);
    expect(desc).toContain("hello");
    const marker = detectGithubMarker(desc);
    expect(marker).toEqual({ repo: "EngineeringMoonBear/AgenticOS", number: 123 });
  });
});
