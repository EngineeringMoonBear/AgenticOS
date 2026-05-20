import { describe, expect, it } from "vitest";
import {
  HermesOfflineError,
  HermesTimeoutError,
  HermesRunNotFoundError,
} from "../src/errors";

describe("HermesOfflineError", () => {
  it("carries 'offline' in message and is instanceof Error", () => {
    const err = new HermesOfflineError("/health");
    expect(err.message).toContain("offline");
    expect(err.message).toContain("/health");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("HermesOfflineError");
  });
});

describe("HermesTimeoutError", () => {
  it("carries the timeout duration", () => {
    const err = new HermesTimeoutError("/runs", 5000);
    expect(err.message).toContain("5000");
    expect(err.name).toBe("HermesTimeoutError");
  });
});

describe("HermesRunNotFoundError", () => {
  it("carries the run id", () => {
    const err = new HermesRunNotFoundError("run_abc123");
    expect(err.message).toContain("run_abc123");
    expect(err.name).toBe("HermesRunNotFoundError");
  });
});
