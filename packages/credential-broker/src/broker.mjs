// AgenticOS credential broker — ADR-0001, Phase 1 skeleton.
//
// A sidecar that holds ONE read-only, vault-scoped 1Password service-account
// token and serves ALLOWLISTED secrets from an in-memory cache. It is the
// generalization of gh-token-broker: consumers (agents, terraform wrappers, CI)
// ask the broker over the compose network and never see the backing token.
//
// Why a broker and not raw `op read` everywhere: 1Password Families caps reads
// at ~1000/day/account. The broker reads each secret ONCE and serves it from
// cache for its TTL, so N callers cost ~1 upstream read, not N.
//
// Security model (Phase 1):
//   - The broker resolves ONLY names present in the secrets map — never an
//     arbitrary op:// ref from the caller. A compromised caller can request at
//     most the pre-declared set, read-only.
//   - Callers authenticate with a broker API key (Bearer). No key → 401.
//   - Per-agent / per-env POLICY and ephemeral DO-token minting are Phase 2+;
//     this skeleton is the cache + allowlist + auth seam they'll hang off.
//
// This module is pure/injectable (no SDK import) so it is unit-testable; the
// real 1Password SDK is wired in main.mjs.

import { createHash, timingSafeEqual } from "node:crypto";

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h — re-read at most hourly per secret

/** Constant-time compare of two strings (avoids API-key timing leaks). */
function safeEqual(a, b) {
  const ha = createHash("sha256").update(String(a)).digest();
  const hb = createHash("sha256").update(String(b)).digest();
  return ha.length === hb.length && timingSafeEqual(ha, hb);
}

/**
 * Build the broker's request handler.
 *
 * @param {object} o
 * @param {(ref: string) => Promise<string>} o.resolve  resolves an op:// ref to a value
 * @param {Record<string,string>} o.secretsMap          allowlist: name -> op:// ref
 * @param {string} o.apiKey                              Bearer key callers must present
 * @param {number} [o.ttlMs]                             cache TTL per secret
 * @param {() => number} [o.now]                         clock (injectable for tests)
 */
export function createBroker({ resolve, secretsMap, apiKey, ttlMs = DEFAULT_TTL_MS, now = Date.now }) {
  if (!apiKey) throw new Error("broker: apiKey is required");
  if (!secretsMap || typeof secretsMap !== "object") throw new Error("broker: secretsMap is required");
  if (typeof resolve !== "function") throw new Error("broker: resolve fn is required");

  /** @type {Map<string,{value:string, expiresAt:number}>} */
  const cache = new Map();
  let upstreamReads = 0;
  let cacheHits = 0;

  /** Cache-through resolve for one allowlisted name. */
  async function getSecret(name) {
    const ref = secretsMap[name];
    if (!ref) return { status: 404, body: { error: `unknown secret '${name}'` } };
    const hit = cache.get(name);
    if (hit && hit.expiresAt > now()) {
      cacheHits++;
      return { status: 200, body: { value: hit.value, cached: true } };
    }
    try {
      const value = await resolve(ref);
      upstreamReads++;
      cache.set(name, { value, expiresAt: now() + ttlMs });
      return { status: 200, body: { value, cached: false } };
    } catch (err) {
      return { status: 502, body: { error: `resolve failed: ${err?.message || String(err)}` } };
    }
  }

  function authed(req) {
    const h = req.headers["authorization"] || "";
    const m = /^Bearer\s+(.+)$/.exec(h);
    return m ? safeEqual(m[1], apiKey) : false;
  }

  /** Node http handler. */
  return async function handler(req, res) {
    const send = (code, obj) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    const url = new URL(req.url, "http://broker");

    // Health is unauthenticated + never touches upstream (compose healthcheck).
    if (req.method === "GET" && url.pathname === "/health") {
      return send(200, { status: "ok", secrets: Object.keys(secretsMap).length, upstreamReads, cacheHits });
    }
    if (!authed(req)) return send(401, { error: "unauthorized" });

    // GET /secret/:name
    const m = /^\/secret\/([A-Za-z0-9_.-]+)$/.exec(url.pathname);
    if (req.method === "GET" && m) {
      const { status, body } = await getSecret(decodeURIComponent(m[1]));
      return send(status, body);
    }
    return send(404, { error: "not found" });
  };
}
