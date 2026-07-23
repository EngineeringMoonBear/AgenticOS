/**
 * gh-token-broker client — mints short-lived, repo-scoped GitHub App installation
 * tokens so the plugin never holds a static PAT and can write to ANY repo the
 * "AgenticOS Developer" App is installed on, across multiple orgs.
 *
 * The broker (scripts/agent-git/github-app-token.mjs, compose service
 * `gh-token-broker`) exposes:
 *   GET {brokerUrl}/token?owner=<owner>&repo=<repo>  ->  { "token": "<installation-token>" }
 * Installation tokens live ~1h; we cache per (owner, repo) for 50 min and refresh.
 */

export type TokenProvider = (repo: string) => Promise<string>;

export interface BrokerOptions {
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Cache lifetime per token. Default 50 min (tokens expire at ~60). */
  ttlMs?: number;
  /** Per-request timeout. Default 5s. */
  timeoutMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
  /**
   * Bearer presented to the broker (M3, PR #356). The broker REFUSES every
   * request without a matching `Authorization: Bearer` — an unauthenticated
   * mint returns HTTP 401 `{"error":"unauthorized"}`, which the pipeline
   * surfaces as "failed to fetch PR changed files". Plugin workers are
   * sandboxed away from host process.env, so this MUST arrive via ctx.config
   * (GithubSyncConfig.tokenBrokerApiKey), not the GH_BROKER_API_KEY env var.
   */
  apiKey?: string;
}

/**
 * Build a per-repo token provider for a single `owner`. Each call resolves a
 * repo-scoped installation token, cached until near expiry. Throws if the broker
 * is unreachable or returns no token — callers handle the failed Result downstream.
 */
export function makeBrokerTokenProvider(
  brokerUrl: string,
  owner: string,
  opts: BrokerOptions = {},
): TokenProvider {
  const ttlMs = opts.ttlMs ?? 50 * 60 * 1000;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const now = opts.now ?? (() => Date.now());
  const doFetch = opts.fetchImpl ?? fetch;
  const apiKey = (opts.apiKey ?? "").trim();
  const base = brokerUrl.replace(/\/$/, "");
  const cache = new Map<string, { token: string; expiresAt: number }>();

  return async (repo: string): Promise<string> => {
    const key = `${owner}/${repo}`.toLowerCase();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now()) return hit.token;

    const url = new URL(`${base}/token`);
    url.searchParams.set("owner", owner);
    url.searchParams.set("repo", repo);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url.toString(), {
        signal: controller.signal,
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      });
      if (!res.ok) throw new Error(`token broker -> ${res.status}`);
      const body = (await res.json()) as { token?: string };
      if (!body.token) throw new Error("token broker returned no token");
      cache.set(key, { token: body.token, expiresAt: now() + ttlMs });
      return body.token;
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Wrap a static token as a TokenProvider (fallback when no broker is configured). */
export function staticTokenProvider(token: string): TokenProvider {
  return async () => token;
}
