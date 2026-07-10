// do-proxy.mjs — credential-broker Phase 2: scoped-capability reverse proxy for
// DigitalOcean. Pure/injectable: signingKey, resolvePat, now, fetchImpl are all
// passed in so this is unit-testable with no network, keys, or real clock.
//
// DO cannot mint short-lived scoped tokens, so instead of handing out a DO token
// we issue an HMAC-signed short-lived capability token and proxy DO API calls,
// injecting the real do_token_scoped PAT server-side. The PAT never leaves here.
import { createHmac, timingSafeEqual, hkdfSync, randomBytes } from "node:crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const fromB64url = (s) => Buffer.from(s, "base64url");
const VALID_SCOPES = new Set(["ro", "rw"]);

/** The HMAC key for capability tokens: explicit BROKER_CAPABILITY_SIGNING_KEY,
 *  else HKDF-derived from BROKER_API_KEY so there is no hard new secret. */
export function deriveSigningKey({ signingKey, apiKey }) {
  if (signingKey) return Buffer.from(signingKey);
  if (!apiKey) throw new Error("do-proxy: need signingKey or apiKey");
  return Buffer.from(
    hkdfSync("sha256", apiKey, Buffer.alloc(0), "credential-broker/do-capability/v1", 32),
  );
}

// Per-process key for a double-HMAC constant-time compare. A KEYED MAC (not a
// bare hash of the key) hides length/timing AND is not a password hash, so it
// doesn't trip CodeQL js/insufficient-password-hash. The bearer key is a
// high-entropy API token compared per-request, not a stored user password, so a
// slow KDF (scrypt/pbkdf2) is the wrong tool here.
const BEARER_COMPARE_KEY = randomBytes(32);

function safeBearer(header, expected) {
  const pfx = "Bearer ";
  if (typeof header !== "string" || !header.startsWith(pfx)) return false;
  const got = createHmac("sha256", BEARER_COMPARE_KEY).update(header.slice(pfx.length)).digest();
  const exp = createHmac("sha256", BEARER_COMPARE_KEY).update(expected).digest();
  return timingSafeEqual(got, exp);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (typeof req.on !== "function") return resolve(Buffer.alloc(0));
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function createDoProxy({
  apiKey,
  resolvePat,
  signingKey,
  now = Date.now,
  fetchImpl = fetch,
  upstream = "https://api.digitalocean.com",
  maxTtlMs = 60 * 60 * 1000,
  defaultTtlMs = 15 * 60 * 1000,
}) {
  if (typeof resolvePat !== "function") throw new Error("do-proxy: resolvePat fn required");
  const key = deriveSigningKey({ signingKey, apiKey });

  function signToken(payload) {
    const body = "v1." + b64url(JSON.stringify(payload));
    const sig = createHmac("sha256", key).update(body).digest();
    return body + "." + b64url(sig);
  }

  function verifyToken(str) {
    if (typeof str !== "string") return { ok: false, error: "missing token" };
    const parts = str.split(".");
    if (parts.length !== 3 || parts[0] !== "v1") return { ok: false, error: "bad format" };
    const body = parts[0] + "." + parts[1];
    const expected = createHmac("sha256", key).update(body).digest();
    const got = fromB64url(parts[2]);
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
      return { ok: false, error: "bad signature" };
    }
    let payload;
    try {
      payload = JSON.parse(fromB64url(parts[1]).toString("utf8"));
    } catch {
      return { ok: false, error: "bad payload" };
    }
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= now()) {
      return { ok: false, error: "expired" };
    }
    if (!VALID_SCOPES.has(payload.scope)) return { ok: false, error: "bad scope" };
    return { ok: true, payload };
  }

  const send = (res, code, obj) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };

  async function mint(req, res) {
    if (!safeBearer(req.headers["authorization"], apiKey)) return send(res, 401, { error: "unauthorized" });
    const url = new URL(req.url, "http://broker");
    const params = Object.fromEntries(url.searchParams);
    if ((req.headers["content-type"] || "").includes("application/json")) {
      const raw = (await readBody(req)).toString("utf8");
      if (raw) { try { Object.assign(params, JSON.parse(raw)); } catch { /* ignore */ } }
    }
    const scope = params.scope || "ro";
    if (!VALID_SCOPES.has(scope)) return send(res, 400, { error: "scope must be ro or rw" });
    let ttlMs = params.ttl ? Number(params.ttl) * 1000 : defaultTtlMs;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) ttlMs = defaultTtlMs;
    ttlMs = Math.min(ttlMs, maxTtlMs);
    const exp = Math.floor((now() + ttlMs) / 1000);
    const token = signToken({ scope, exp, iss: "agenticos-broker" });
    return send(res, 200, { token, scope, expiresAt: new Date(exp * 1000).toISOString() });
  }

  async function proxy(req, res) {
    const auth = req.headers["authorization"] || "";
    const cap = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    const v = verifyToken(cap);
    if (!v.ok) return send(res, 401, { error: v.error });

    const method = (req.method || "GET").toUpperCase();
    const isWrite = !(method === "GET" || method === "HEAD");
    if (v.payload.scope === "ro" && isWrite) return send(res, 403, { error: "capability is read-only" });

    const url = new URL(req.url, "http://broker");
    const rest = url.pathname.replace(/^\/do(?=\/|$)/, "") + url.search;
    const target = upstream + rest;

    let pat;
    try {
      pat = await resolvePat();
    } catch {
      return send(res, 502, { error: "PAT unavailable" });
    }

    const headers = { authorization: `Bearer ${pat}` };
    if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"];
    const body = isWrite ? await readBody(req) : undefined;

    let up;
    try {
      up = await fetchImpl(target, { method, headers, body: body && body.length ? body : undefined });
    } catch {
      return send(res, 502, { error: "upstream request failed" });
    }
    const buf = Buffer.from(await up.arrayBuffer());
    const ct = (up.headers.get ? up.headers.get("content-type") : up.headers["content-type"]) || "application/json";
    res.writeHead(up.status, { "content-type": ct });
    res.end(buf);
  }

  return { signToken, verifyToken, mint, proxy };
}
