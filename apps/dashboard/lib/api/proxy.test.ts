/**
 * Fix 5: Unit tests for the DNS-rebinding host/origin check logic.
 *
 * We import `isAllowedRequest` — the pure helper extracted from proxy.ts —
 * so these tests run entirely in Node without a Next.js request cycle.
 */
import { describe, it, expect } from "vitest";
import { isAllowedRequest } from "../../proxy";

function makeRequest(
  method: string,
  headers: Record<string, string>
): Request {
  return new Request("http://localhost:3000/api/test", {
    method,
    headers,
  });
}

describe("isAllowedRequest — host check", () => {
  it("allows GET with host=localhost:3000", () => {
    const req = makeRequest("GET", { host: "localhost:3000" });
    expect(isAllowedRequest(req).allowed).toBe(true);
  });

  it("rejects GET with host=evil.com:3000", () => {
    const req = makeRequest("GET", { host: "evil.com:3000" });
    const result = isAllowedRequest(req);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("Forbidden host");
  });

  it("allows GET with host=127.0.0.1:3000", () => {
    const req = makeRequest("GET", { host: "127.0.0.1:3000" });
    expect(isAllowedRequest(req).allowed).toBe(true);
  });

  it("allows GET with host matching App Platform pattern", () => {
    const req = makeRequest("GET", {
      host: "agenticos-dashboard-w2i7d.ondigitalocean.app",
    });
    expect(isAllowedRequest(req).allowed).toBe(true);
  });

  it("rejects GET with host that looks like a fake App Platform URL", () => {
    const req = makeRequest("GET", {
      host: "agenticos-dashboard.ondigitalocean.app.evil.com",
    });
    expect(isAllowedRequest(req).allowed).toBe(false);
  });
});

describe("isAllowedRequest — origin check on state-changing methods", () => {
  it("allows POST with host=localhost:3000 and origin=http://localhost:3000", () => {
    const req = makeRequest("POST", {
      host: "localhost:3000",
      origin: "http://localhost:3000",
    });
    expect(isAllowedRequest(req).allowed).toBe(true);
  });

  it("rejects POST with host=localhost:3000 and origin=http://evil.com", () => {
    const req = makeRequest("POST", {
      host: "localhost:3000",
      origin: "http://evil.com",
    });
    const result = isAllowedRequest(req);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("Forbidden origin");
  });

  it("allows POST with host=localhost:3000 and missing origin (same-origin request)", () => {
    const req = makeRequest("POST", { host: "localhost:3000" });
    expect(isAllowedRequest(req).allowed).toBe(true);
  });
});
