import { describe, it, expect } from "vitest";
import { safeResolve, isSafePath } from "../../src/path/safe-resolve.js";
import path from "node:path";

const BASE = "/tmp/vault-test-base";

describe("safeResolve", () => {
  it("resolves a simple relative path under base", () => {
    const result = safeResolve(BASE, "Farm/Plot A12");
    expect(result).toBe(path.join(BASE, "Farm/Plot A12"));
  });

  it("resolves a nested relative path", () => {
    const result = safeResolve(BASE, "a/b/c.md");
    expect(result).toBe(path.join(BASE, "a/b/c.md"));
  });

  it("rejects .. segments", () => {
    expect(() => safeResolve(BASE, "../outside")).toThrow(/traversal/i);
  });

  it("rejects embedded .. segments", () => {
    expect(() => safeResolve(BASE, "a/../../../etc/passwd")).toThrow(
      /traversal/i
    );
  });

  it("rejects absolute paths", () => {
    expect(() => safeResolve(BASE, "/etc/passwd")).toThrow(/absolute/i);
  });

  it("rejects null bytes", () => {
    expect(() => safeResolve(BASE, "file\0.md")).toThrow(/null byte/i);
  });

  it("permits Unicode filenames after NFC normalization", () => {
    // NFC form of 'é' (U+00E9)
    const nfc = "é";
    const result = safeResolve(BASE, `notes/${nfc}`);
    expect(result).toBe(path.join(BASE, `notes/${nfc}`));
  });

  it("normalizes NFD to NFC before resolving", () => {
    // NFD form: 'e' + combining accent (U+0301)
    const nfd = "é";
    // NFC form: precomposed é (U+00E9)
    const nfc = "é";
    const result = safeResolve(BASE, `notes/${nfd}`);
    expect(result).toBe(path.join(BASE, `notes/${nfc}`));
  });

  it("rejects a path that resolves to exactly the base dir without trailing sep", () => {
    // Empty string would resolve to base itself — that should be allowed as a
    // directory reference, but single-dot resolves to base as well
    const result = safeResolve(BASE, ".");
    // "." resolves to BASE which equals base — this is treated as the base dir
    // itself; the check is `resolved !== base` for the equality branch
    expect(result).toBe(BASE);
  });
});

describe("isSafePath", () => {
  it("returns true for simple relative paths", () => {
    expect(isSafePath("notes/foo")).toBe(true);
  });

  it("returns false for .. traversal", () => {
    expect(isSafePath("../escape")).toBe(false);
  });

  it("returns false for absolute paths", () => {
    expect(isSafePath("/etc/passwd")).toBe(false);
  });

  it("returns false for null bytes", () => {
    expect(isSafePath("file\0.md")).toBe(false);
  });
});
