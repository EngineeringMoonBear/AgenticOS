import type { PluginHttpClient } from "@paperclipai/plugin-sdk";

/**
 * REST-bypass fallback for the inbound webhook path (GOL-323).
 *
 * The Paperclip host expires the plugin's per-delivery invocation scope when the
 * webhook HTTP-200 is sent, before an awaited `ctx.issues.*` write lands —
 * dropping ~230 inbound writes/day with a "missing, expired, or unknown
 * invocation scope" error. No sandbox-native fix exists (the scope lifetime is
 * host-controlled; see runInScope / captureInvocationScope, GOL-179). The
 * board-authorized interim mitigation: on a scope-expiry error ONLY, retry the
 * write against the Paperclip REST API with a configured bearer token.
 *
 * This module is deliberately small and dependency-free — it only touches the
 * already-failing path, so it is zero-risk to the working scope-based path.
 */

/**
 * True when `err` is the host's invocation-scope-expiry error. Lenient/robust:
 * matches the "invocation scope" phrase plus one of expired/missing/unknown, so
 * it survives minor host wording changes ("missing, expired, or unknown
 * invocation scope"). Only this error triggers the REST fallback.
 */
export function isScopeExpiryError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (!msg.includes("invocation scope")) return false;
  return msg.includes("expired") || msg.includes("missing") || msg.includes("unknown");
}

/** Minimal shape of a Paperclip issue as returned by the REST API. Mirrors the
 * fields the inbound path reads (`id`, `status`) — kept loose to avoid coupling
 * to the full SDK `Issue` type. */
export interface RestIssue {
  id: string;
  status?: string;
  [key: string]: unknown;
}

export interface PaperclipRestClientOptions {
  baseUrl: string;
  token: string;
  http: PluginHttpClient;
}

/**
 * Thin REST client over `ctx.http.fetch`. Used only as the scope-expiry
 * catch-fallback — every method mirrors the corresponding `ctx.issues.*` call
 * and returns the same-shaped JSON so downstream code is unchanged.
 */
export class PaperclipRestClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly http: PluginHttpClient;

  constructor(opts: PaperclipRestClientOptions) {
    // Strip a trailing slash so `${baseUrl}/api/...` never double-slashes.
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.http = opts.http;
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      authorization: "Bearer " + this.token,
    };
  }

  private async assertOk(res: Response, what: string): Promise<void> {
    if (res.ok) return;
    let snippet = "";
    try {
      snippet = (await res.text()).slice(0, 300);
    } catch {
      // body unreadable — status alone is enough context
    }
    throw new Error(`Paperclip REST ${what} failed: ${res.status} ${res.statusText} ${snippet}`.trim());
  }

  /**
   * POST /api/companies/{companyId}/issues — mirror of `ctx.issues.create`. `body`
   * is the SAME object passed to ctx.issues.create MINUS `companyId` (which moves
   * into the URL). Returns the created issue JSON (has `id`).
   */
  async createIssue(companyId: string, body: Record<string, unknown>): Promise<RestIssue> {
    const url = `${this.baseUrl}/api/companies/${encodeURIComponent(companyId)}/issues`;
    const res = await this.http.fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    await this.assertOk(res, "createIssue");
    return (await res.json()) as RestIssue;
  }

  /**
   * GET /api/issues/{issueId} — mirror of `ctx.issues.get`. Returns the issue JSON,
   * or null on 404 (matching ctx.issues.get's `Issue | null`).
   */
  async getIssue(issueId: string): Promise<RestIssue | null> {
    const url = `${this.baseUrl}/api/issues/${encodeURIComponent(issueId)}`;
    const res = await this.http.fetch(url, {
      method: "GET",
      headers: this.headers(),
    });
    if (res.status === 404) return null;
    await this.assertOk(res, "getIssue");
    return (await res.json()) as RestIssue;
  }

  /**
   * PATCH /api/issues/{issueId} — mirror of `ctx.issues.update`. `patch` is the
   * same partial passed to ctx.issues.update. Returns the updated issue JSON.
   */
  async updateIssue(issueId: string, patch: Record<string, unknown>): Promise<RestIssue> {
    const url = `${this.baseUrl}/api/issues/${encodeURIComponent(issueId)}`;
    const res = await this.http.fetch(url, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify(patch),
    });
    await this.assertOk(res, "updateIssue");
    return (await res.json()) as RestIssue;
  }
}
