import { describe, it, expect } from "vitest";
import {
  isScopeExpiryError,
  PaperclipRestClient,
} from "../src/paperclip-rest.js";

/**
 * Minimal fake of the SDK `ctx.http` surface. Records every request so we can
 * assert the URL, method, and headers the REST fallback sends — in particular
 * the CF Access service-token headers, which are mandatory for the gated public
 * host (the only reachable target; the internal loopback is SSRF-blocked).
 */
function makeFakeHttp(responder: (url: string, init?: any) => { status: number; body?: unknown }) {
  const calls: Array<{ url: string; init: any }> = [];
  return {
    calls,
    http: {
      async fetch(url: string, init?: any) {
        calls.push({ url, init });
        const { status, body } = responder(url, init);
        return {
          ok: status >= 200 && status < 300,
          status,
          statusText: String(status),
          async json() {
            return body ?? {};
          },
          async text() {
            return typeof body === "string" ? body : JSON.stringify(body ?? {});
          },
        };
      },
    } as any,
  };
}

describe("isScopeExpiryError", () => {
  it("matches the host's expired/missing/unknown invocation-scope wording", () => {
    for (const msg of [
      'not allowed to perform "issues.create": the worker referenced a missing, expired, or unknown invocation scope',
      "expired invocation scope",
      "unknown invocation scope",
    ]) {
      expect(isScopeExpiryError(new Error(msg))).toBe(true);
    }
  });

  it("does NOT match unrelated errors (fallback must fire ONLY on scope-expiry)", () => {
    for (const msg of ["network timeout", "500 internal error", "invocation scope refreshed ok"]) {
      expect(isScopeExpiryError(new Error(msg))).toBe(false);
    }
    // "invocation scope" alone (no expired/missing/unknown) must not trigger.
    expect(isScopeExpiryError(new Error("created invocation scope"))).toBe(false);
  });
});

describe("PaperclipRestClient headers", () => {
  it("sends CF Access service-token headers when both id and secret are set", async () => {
    const { calls, http } = makeFakeHttp(() => ({ status: 200, body: { id: "i1" } }));
    const client = new PaperclipRestClient({
      baseUrl: "https://paperclip.example.com/",
      token: "bearer-tok",
      http,
      cfAccessClientId: "cf-id",
      cfAccessClientSecret: "cf-secret",
    });
    await client.getIssue("i1");
    const h = calls[0]!.init.headers;
    expect(h.authorization).toBe("Bearer bearer-tok");
    expect(h["CF-Access-Client-Id"]).toBe("cf-id");
    expect(h["CF-Access-Client-Secret"]).toBe("cf-secret");
  });

  it("omits CF Access headers when the pair is incomplete", async () => {
    const { calls, http } = makeFakeHttp(() => ({ status: 200, body: { id: "i1" } }));
    const client = new PaperclipRestClient({
      baseUrl: "https://paperclip.example.com",
      token: "t",
      http,
      cfAccessClientId: "cf-id", // secret missing
    });
    await client.getIssue("i1");
    const h = calls[0]!.init.headers;
    expect(h["CF-Access-Client-Id"]).toBeUndefined();
    expect(h["CF-Access-Client-Secret"]).toBeUndefined();
  });
});

describe("PaperclipRestClient verbs", () => {
  const base = { baseUrl: "https://p.example.com", token: "t" };

  it("createIssue POSTs to /api/companies/{companyId}/issues with the body", async () => {
    const { calls, http } = makeFakeHttp(() => ({ status: 201, body: { id: "new-1" } }));
    const client = new PaperclipRestClient({ ...base, http });
    const issue = await client.createIssue("co-1", { projectId: "p1", title: "T" });
    expect(calls[0]!.url).toBe("https://p.example.com/api/companies/co-1/issues");
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(calls[0]!.init.body)).toEqual({ projectId: "p1", title: "T" });
    expect(issue.id).toBe("new-1");
  });

  it("getIssue returns null on 404 (mirrors ctx.issues.get)", async () => {
    const { http } = makeFakeHttp(() => ({ status: 404 }));
    const client = new PaperclipRestClient({ ...base, http });
    expect(await client.getIssue("missing")).toBeNull();
  });

  it("updateIssue PATCHes /api/issues/{id} with the patch", async () => {
    const { calls, http } = makeFakeHttp(() => ({ status: 200, body: { id: "i9", status: "done" } }));
    const client = new PaperclipRestClient({ ...base, http });
    await client.updateIssue("i9", { status: "done" });
    expect(calls[0]!.url).toBe("https://p.example.com/api/issues/i9");
    expect(calls[0]!.init.method).toBe("PATCH");
    expect(JSON.parse(calls[0]!.init.body)).toEqual({ status: "done" });
  });

  it("throws with status + body snippet on a non-ok response (e.g. CF 302 redirect)", async () => {
    const { http } = makeFakeHttp(() => ({ status: 302, body: "redirect to cloudflareaccess.com" }));
    const client = new PaperclipRestClient({ ...base, http });
    await expect(client.getIssue("i1")).rejects.toThrow(/getIssue failed: 302/);
  });
});
