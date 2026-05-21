import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getHonchoClient, resetHonchoClientForTests } from "./honcho-client";

describe("honcho-client", () => {
  beforeEach(() => {
    resetHonchoClientForTests();
    process.env.HONCHO_URL = "http://localhost:8000";
  });

  it("returns a singleton client", () => {
    const a = getHonchoClient();
    const b = getHonchoClient();
    expect(a).toBe(b);
  });

  it("uses HONCHO_URL env var as base URL", () => {
    process.env.HONCHO_URL = "http://example:8000";
    resetHonchoClientForTests();
    const client = getHonchoClient();
    expect((client as any).baseURL ?? (client as any).options?.baseURL).toMatch(/example:8000/);
  });

  it("throws if HONCHO_URL is missing", () => {
    delete process.env.HONCHO_URL;
    resetHonchoClientForTests();
    expect(() => getHonchoClient()).toThrow(/HONCHO_URL/);
  });
});
