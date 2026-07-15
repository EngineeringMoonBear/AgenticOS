import { describe, it, expect } from "vitest";
import {
  isScopeExpiryError,
  PaperclipRestClient,
  PaperclipRestError,
  withRestFallback,
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

  it("createComment POSTs to /api/issues/{id}/comments with the `body` field", async () => {
    const { calls, http } = makeFakeHttp(() => ({ status: 201, body: { id: "c1" } }));
    const client = new PaperclipRestClient({ ...base, http });
    await client.createComment("i9", "new commits pushed");
    expect(calls[0]!.url).toBe("https://p.example.com/api/issues/i9/comments");
    expect(calls[0]!.init.method).toBe("POST");
    // The API field is `body`; a wrong name 200s and silently drops the text.
    expect(JSON.parse(calls[0]!.init.body)).toEqual({ body: "new commits pushed" });
  });

  it("surfaces the HTTP status on the thrown error (PaperclipRestError)", async () => {
    const { http } = makeFakeHttp(() => ({ status: 403, body: "forbidden" }));
    const client = new PaperclipRestClient({ ...base, http });
    await expect(client.createComment("i1", "x")).rejects.toMatchObject({
      name: "PaperclipRestError",
      status: 403,
    });
  });
});

/** Records the structured log lines withRestFallback emits. */
function makeFakeLogger() {
  const lines: Array<{ level: string; message: string; meta?: Record<string, unknown> }> = [];
  const at = (level: string) => (message: string, meta?: Record<string, unknown>) =>
    void lines.push({ level, message, meta });
  return { lines, logger: { info: at("info"), warn: at("warn"), error: at("error") } };
}

const SCOPE_ERR = new Error(
  'not allowed to perform "issues.create": the worker referenced a missing, expired, or unknown invocation scope',
);

describe("withRestFallback", () => {
  const anyRest = () => new PaperclipRestClient({ baseUrl: "https://p.example.com", token: "t", http: {} as any });

  it("returns the scope-based result and logs nothing when the primary call succeeds", async () => {
    const { lines, logger } = makeFakeLogger();
    const restFn = () => Promise.reject(new Error("must not be called"));
    const out = await withRestFallback({ logger, rest: anyRest() }, "review.create", async () => "ok", restFn);
    expect(out).toBe("ok");
    expect(lines).toEqual([]);
  });

  it("retries via REST on scope-expiry and logs warn + success with the site", async () => {
    const { lines, logger } = makeFakeLogger();
    const out = await withRestFallback(
      { logger, rest: anyRest() },
      "review.create",
      () => Promise.reject(SCOPE_ERR),
      async () => "from-rest",
    );
    expect(out).toBe("from-rest");
    expect(lines.map((l) => l.level)).toEqual(["warn", "info"]);
    expect(lines[1]!.message).toMatch(/fallback succeeded/);
    expect(lines[1]!.meta).toMatchObject({ site: "review.create" });
  });

  /**
   * The GOL-384 regression: a fallback that 403s on every attempt used to rethrow
   * with no log line, so a wholly broken fallback was indistinguishable under grep
   * from one that never fired — which is how a broken deploy got signed off.
   */
  it("logs an error with site + status when the REST retry itself fails, then rethrows", async () => {
    const { lines, logger } = makeFakeLogger();
    const restErr = new PaperclipRestError("Paperclip REST createIssue failed: 403 Forbidden", 403);
    await expect(
      withRestFallback(
        { logger, rest: anyRest() },
        "review.create",
        () => Promise.reject(SCOPE_ERR),
        () => Promise.reject(restErr),
      ),
    ).rejects.toBe(restErr);

    const failure = lines.find((l) => l.level === "error");
    expect(failure).toBeDefined();
    expect(failure!.message).toBe("Paperclip REST fallback failed (GOL-323)");
    expect(failure!.meta).toMatchObject({ site: "review.create", status: 403 });
    expect(String(failure!.meta!.error)).toMatch(/403 Forbidden/);
    // No success line may be emitted on a failed retry.
    expect(lines.some((l) => l.level === "info")).toBe(false);
  });

  it("logs the failure even when the REST retry throws a non-HTTP error (status undefined)", async () => {
    const { lines, logger } = makeFakeLogger();
    await expect(
      withRestFallback(
        { logger, rest: anyRest() },
        "ci.comment",
        () => Promise.reject(SCOPE_ERR),
        () => Promise.reject(new Error("network unreachable")),
      ),
    ).rejects.toThrow(/network unreachable/);
    const failure = lines.find((l) => l.level === "error")!;
    expect(failure.meta).toMatchObject({ site: "ci.comment", status: undefined });
    expect(String(failure.meta!.error)).toMatch(/network unreachable/);
  });

  it("rethrows the ORIGINAL error untouched for a non-scope-expiry failure", async () => {
    const { lines, logger } = makeFakeLogger();
    const other = new Error("validation failed: title required");
    await expect(
      withRestFallback({ logger, rest: anyRest() }, "mirror.create", () => Promise.reject(other), async () => "rest"),
    ).rejects.toBe(other);
    expect(lines).toEqual([]);
  });

  it("rethrows the original error when the fallback is not configured (rest = null)", async () => {
    const { lines, logger } = makeFakeLogger();
    await expect(
      withRestFallback({ logger, rest: null }, "mirror.create", () => Promise.reject(SCOPE_ERR), async () => "rest"),
    ).rejects.toBe(SCOPE_ERR);
    expect(lines).toEqual([]);
  });
});
