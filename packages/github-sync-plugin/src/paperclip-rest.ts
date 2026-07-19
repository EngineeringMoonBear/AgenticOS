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

/**
 * A non-2xx response from the Paperclip REST API. Carries the HTTP `status` so
 * the fallback-failure log line can report it structurally instead of forcing a
 * grep of the message text (GOL-384).
 */
export class PaperclipRestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PaperclipRestError";
    this.status = status;
  }
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
  /**
   * Cloudflare Access service-token credentials. REQUIRED when baseUrl is the
   * CF-Access-gated public host — which is the ONLY reachable target: the host's
   * plugin `http.outbound` SSRF filter blocks the internal loopback (127.0.0.1),
   * so the fallback cannot use the internal listener. Without these the CF Access
   * edge 302-redirects the request to the login page and the write never reaches
   * the API. Sent as `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers,
   * which CF's `non_identity` service-token policy honours. Omit only if baseUrl
   * points at an un-gated origin.
   */
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
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
  private readonly cfAccessClientId?: string;
  private readonly cfAccessClientSecret?: string;

  constructor(opts: PaperclipRestClientOptions) {
    // Strip a trailing slash so `${baseUrl}/api/...` never double-slashes.
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.http = opts.http;
    this.cfAccessClientId = opts.cfAccessClientId;
    this.cfAccessClientSecret = opts.cfAccessClientSecret;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "content-type": "application/json",
      authorization: "Bearer " + this.token,
    };
    // Pass the CF Access edge when baseUrl is the gated public host. Both must be
    // present to be meaningful; a partial pair is dropped rather than sent.
    if (this.cfAccessClientId && this.cfAccessClientSecret) {
      h["CF-Access-Client-Id"] = this.cfAccessClientId;
      h["CF-Access-Client-Secret"] = this.cfAccessClientSecret;
    }
    return h;
  }

  private async assertOk(res: Response, what: string): Promise<void> {
    if (res.ok) return;
    let snippet = "";
    try {
      snippet = (await res.text()).slice(0, 300);
    } catch {
      // body unreadable — status alone is enough context
    }
    throw new PaperclipRestError(
      `Paperclip REST ${what} failed: ${res.status} ${res.statusText} ${snippet}`.trim(),
      res.status,
    );
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

  /**
   * POST /api/issues/{issueId}/comments — mirror of `ctx.issues.createComment`.
   * The API field is `body` (NOT `content`/`comment`); a wrong field name is
   * accepted with a 200 and silently drops the text.
   */
  async createComment(issueId: string, body: string): Promise<void> {
    const url = `${this.baseUrl}/api/issues/${encodeURIComponent(issueId)}/comments`;
    const res = await this.http.fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ body }),
    });
    await this.assertOk(res, "createComment");
  }
}

/** The subset of `ctx.logger` the fallback helper needs. */
export interface FallbackLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Run `fn` (the normal scope-based `ctx.issues.*` call) and, ONLY when it fails
 * with the host's scope-expiry error and a REST client is configured, retry via
 * `restFn`.
 *
 * Every outcome is logged against `site` so the fallback's real behaviour is
 * greppable — in particular the failure path (GOL-384): before this, a fallback
 * that 403'd on every attempt rethrew silently, so a wholly broken fallback
 * looked identical to one that never fired.
 *
 * Behaviour is otherwise preserved exactly: a non-scope-expiry error, or an
 * unconfigured fallback, rethrows the ORIGINAL error; a failed retry rethrows
 * the REST error.
 */
export async function withRestFallback<T>(
  deps: { logger: FallbackLogger; rest: PaperclipRestClient | null },
  site: string,
  fn: () => Promise<T>,
  restFn: (rest: PaperclipRestClient) => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const { logger, rest } = deps;
    if (!isScopeExpiryError(err) || !rest) throw err;
    logger.warn("inbound write hit scope-expiry; retrying via Paperclip REST fallback (GOL-323)", { site });
    try {
      const result = await restFn(rest);
      logger.info("Paperclip REST fallback succeeded (GOL-323)", { site });
      return result;
    } catch (restErr) {
      logger.error("Paperclip REST fallback failed (GOL-323)", {
        site,
        status: restErr instanceof PaperclipRestError ? restErr.status : undefined,
        error: restErr instanceof Error ? restErr.message : String(restErr),
      });
      throw restErr;
    }
  }
}
