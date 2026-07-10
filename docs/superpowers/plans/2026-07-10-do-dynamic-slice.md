# DO Dynamic Slice (credential-broker Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a scoped-capability reverse proxy to the credential broker so callers reach the DigitalOcean API with short-lived capability tokens while the real `do_token_scoped` PAT never leaves the broker.

**Architecture:** A new pure/injectable module `src/do-proxy.mjs` implements HMAC-signed capability tokens, a mint handler, and a DO reverse proxy. `src/main.mjs` mounts two routes (`POST /token/digitalocean`, `ALL /do/*`) that delegate to it and injects the real PAT via a small TTL-cached resolver. `broker.mjs` and its tests are untouched. Terraform routes through the broker via `DIGITALOCEAN_API_URL` + `DIGITALOCEAN_TOKEN` — zero terraform code change.

**Tech Stack:** Node ≥22, ESM (`.mjs`), `node:crypto` + `node:test` only — **no new npm dependencies**. `@1password/sdk` already present (unused by this slice directly).

**Spec:** `docs/superpowers/specs/2026-07-10-do-dynamic-slice-design.md`

## Global Constraints

- **No new npm dependencies.** Only `node:crypto`, `node:http`, `node:test`, and the already-installed `@1password/sdk`.
- **`packages/credential-broker/src/broker.mjs` and `test/broker.test.mjs` MUST NOT be modified.** This slice is additive.
- **`do-proxy.mjs` is pure/injectable:** `signingKey`, `resolvePat`, `now`, and `fetchImpl` are all constructor-injected so tests need no network, real keys, or real clock.
- **Bearer parsing MUST be linear** (no regex with `\s+(.+)` — a CodeQL polynomial-ReDoS finding was already fixed on this branch). Use `header.startsWith("Bearer ")` + `slice`.
- **Never log or echo secret values** (PAT, capability tokens). Errors carry reasons, not values.
- **Capability token format:** `v1.<base64url(payloadJSON)>.<base64url(HMAC-SHA256(body))>` where `body = "v1." + base64url(payloadJSON)` and `payload = {scope, exp, iss:"agenticos-broker"}`, `exp` in unix **seconds**.
- **Scopes:** `ro` (GET/HEAD only) or `rw` (all methods). Unknown scope → 400 (mint) / reject (verify).
- **TTL:** default 900 s, hard cap 3600 s (clamp, don't reject).
- **Upstream host hardcoded** `https://api.digitalocean.com` — never caller-controlled.
- **Git:** work on a branch off `origin/main` (`infra/gol-77-do-proxy`); never push to main. Commit with `git -c commit.gpgsign=false` and `PRE_COMMIT_ALLOW_NO_CONFIG=1`. End commit messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Run tests from** `packages/credential-broker/`.

## File Structure

- **Create** `packages/credential-broker/src/do-proxy.mjs` — capability token sign/verify, `mint(req,res)`, `proxy(req,res)`. Pure factory `createDoProxy(opts)`.
- **Create** `packages/credential-broker/test/do-proxy.test.mjs` — unit tests (grows across Tasks 1–3).
- **Modify** `packages/credential-broker/src/main.mjs` — export `createRequestHandler({brokerHandler, doProxy})`; wire the PAT resolver + routes; 503 when the PAT isn't configured.
- **Create** `packages/credential-broker/test/main-dispatch.test.mjs` — unit tests for route dispatch.
- **Create** `packages/credential-broker/client/do-broker-env.sh` — terraform env helper.
- **Modify** `packages/credential-broker/README.md` — DO proxy usage section.

---

### Task 1: Capability token core (sign / verify / key derivation)

**Files:**
- Create: `packages/credential-broker/src/do-proxy.mjs`
- Test: `packages/credential-broker/test/do-proxy.test.mjs`

**Interfaces:**
- Produces: `deriveSigningKey({signingKey, apiKey}) -> Buffer`; `createDoProxy(opts) -> { signToken, verifyToken, mint, proxy }` (only `signToken`/`verifyToken` in this task). `signToken(payload) -> string`. `verifyToken(str) -> {ok:true, payload} | {ok:false, error}`. `opts` = `{apiKey, resolvePat, signingKey, now=Date.now, fetchImpl=fetch, upstream="https://api.digitalocean.com", maxTtlMs=3600000, defaultTtlMs=900000}`.

- [ ] **Step 1: Write the failing test**

Create `packages/credential-broker/test/do-proxy.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDoProxy, deriveSigningKey } from "../src/do-proxy.mjs";

const OPTS = { apiKey: "broker-key", resolvePat: async () => "dop_v1_PAT", now: () => 1_000_000 };

test("deriveSigningKey: explicit key wins over apiKey", () => {
  const k = deriveSigningKey({ signingKey: "explicit", apiKey: "x" });
  assert.ok(Buffer.isBuffer(k));
  assert.equal(k.toString(), "explicit");
});

test("deriveSigningKey: derives a 32-byte key from apiKey when no signingKey", () => {
  const k = deriveSigningKey({ apiKey: "broker-key" });
  assert.equal(k.length, 32);
});

test("signToken → verifyToken roundtrip returns payload", () => {
  const p = createDoProxy(OPTS);
  const tok = p.signToken({ scope: "rw", exp: 2_000, iss: "agenticos-broker" });
  const v = p.verifyToken(tok);
  assert.equal(v.ok, true);
  assert.equal(v.payload.scope, "rw");
});

test("verifyToken rejects a tampered payload", () => {
  const p = createDoProxy(OPTS);
  const tok = p.signToken({ scope: "ro", exp: 2_000, iss: "agenticos-broker" });
  const [ver, , sig] = tok.split(".");
  const forged = ver + "." + Buffer.from('{"scope":"rw","exp":2000}').toString("base64url") + "." + sig;
  assert.equal(p.verifyToken(forged).ok, false);
});

test("verifyToken rejects an expired token", () => {
  const p = createDoProxy(OPTS); // now() = 1_000_000 ms → 1000 s
  const tok = p.signToken({ scope: "ro", exp: 999, iss: "agenticos-broker" });
  const v = p.verifyToken(tok);
  assert.equal(v.ok, false);
  assert.equal(v.error, "expired");
});

test("verifyToken rejects bad format / version", () => {
  const p = createDoProxy(OPTS);
  assert.equal(p.verifyToken("nope").ok, false);
  assert.equal(p.verifyToken("v2.a.b").ok, false);
  assert.equal(p.verifyToken(undefined).ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/credential-broker && node --test test/do-proxy.test.mjs`
Expected: FAIL — `Cannot find module '../src/do-proxy.mjs'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/credential-broker/src/do-proxy.mjs`:

```js
// do-proxy.mjs — credential-broker Phase 2: scoped-capability reverse proxy for
// DigitalOcean. Pure/injectable: signingKey, resolvePat, now, fetchImpl are all
// passed in so this is unit-testable with no network, keys, or real clock.
//
// DO cannot mint short-lived scoped tokens, so instead of handing out a DO token
// we issue an HMAC-signed short-lived capability token and proxy DO API calls,
// injecting the real do_token_scoped PAT server-side. The PAT never leaves here.
import { createHmac, createHash, timingSafeEqual, hkdfSync } from "node:crypto";

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

  // mint() and proxy() are added in Tasks 2 and 3.
  return { signToken, verifyToken };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/credential-broker && node --test test/do-proxy.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/credential-broker/src/do-proxy.mjs packages/credential-broker/test/do-proxy.test.mjs
git -c commit.gpgsign=false commit -m "feat(credential-broker): capability token sign/verify core (Phase 2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Mint handler (`POST /token/digitalocean`)

**Files:**
- Modify: `packages/credential-broker/src/do-proxy.mjs`
- Test: `packages/credential-broker/test/do-proxy.test.mjs`

**Interfaces:**
- Consumes: `createDoProxy` from Task 1.
- Produces: `mint(req, res) -> Promise<void>`. Auth `Bearer apiKey`. Params from query and/or JSON body: `scope` (default `ro`), `ttl` seconds (default `defaultTtlMs/1000`, clamped to `maxTtlMs/1000`). Response `200 {token, scope, expiresAt}`; `401` no/bad auth; `400` unknown scope.

- [ ] **Step 1: Write the failing test**

Append to `packages/credential-broker/test/do-proxy.test.mjs`:

```js
// --- helpers for handler tests (req/res doubles) ---
function mkReq({ method = "GET", url = "/", auth, headers = {} } = {}) {
  const h = { ...headers };
  if (auth) h["authorization"] = `Bearer ${auth}`;
  return { method, url, headers: h }; // no .on → handlers treat as empty body
}
function mkRes() {
  return {
    statusCode: undefined,
    body: undefined,
    headersSent: false,
    writeHead(code) { this.statusCode = code; this.headersSent = true; },
    end(payload) { this.body = payload ? JSON.parse(payload) : undefined; },
  };
}

test("mint: 401 without the broker api key", async () => {
  const p = createDoProxy(OPTS);
  const res = mkRes();
  await p.mint(mkReq({ method: "POST", url: "/token/digitalocean" }), res);
  assert.equal(res.statusCode, 401);
});

test("mint: returns a usable capability token (default scope ro)", async () => {
  const p = createDoProxy(OPTS);
  const res = mkRes();
  await p.mint(mkReq({ method: "POST", url: "/token/digitalocean", auth: "broker-key" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.scope, "ro");
  assert.equal(p.verifyToken(res.body.token).ok, true);
  assert.ok(typeof res.body.expiresAt === "string");
});

test("mint: honors scope=rw and clamps ttl to the max", async () => {
  const p = createDoProxy({ ...OPTS, maxTtlMs: 3_600_000 });
  const res = mkRes();
  await p.mint(mkReq({ method: "POST", url: "/token/digitalocean?scope=rw&ttl=999999", auth: "broker-key" }), res);
  assert.equal(res.body.scope, "rw");
  const v = p.verifyToken(res.body.token);
  // now()=1_000_000ms → 1000s; clamp 3600s → exp 4600
  assert.equal(v.payload.exp, 1000 + 3600);
});

test("mint: 400 on unknown scope", async () => {
  const p = createDoProxy(OPTS);
  const res = mkRes();
  await p.mint(mkReq({ method: "POST", url: "/token/digitalocean?scope=admin", auth: "broker-key" }), res);
  assert.equal(res.statusCode, 400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/credential-broker && node --test test/do-proxy.test.mjs`
Expected: FAIL — `p.mint is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/do-proxy.mjs`, add these helpers above `createDoProxy` (module scope):

```js
function safeBearer(header, expected) {
  const pfx = "Bearer ";
  if (typeof header !== "string" || !header.startsWith(pfx)) return false;
  const got = createHash("sha256").update(header.slice(pfx.length)).digest();
  const exp = createHash("sha256").update(expected).digest();
  return got.length === exp.length && timingSafeEqual(got, exp);
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
```

Inside `createDoProxy`, before the `return`, add `mint` and include it in the returned object:

```js
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
```

Change the return to: `return { signToken, verifyToken, mint };`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/credential-broker && node --test test/do-proxy.test.mjs`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/credential-broker/src/do-proxy.mjs packages/credential-broker/test/do-proxy.test.mjs
git -c commit.gpgsign=false commit -m "feat(credential-broker): DO capability mint endpoint (Phase 2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Reverse proxy handler (`ALL /do/*`)

**Files:**
- Modify: `packages/credential-broker/src/do-proxy.mjs`
- Test: `packages/credential-broker/test/do-proxy.test.mjs`

**Interfaces:**
- Consumes: `createDoProxy`, `signToken`, `verifyToken`, `resolvePat`, `fetchImpl` from prior tasks.
- Produces: `proxy(req, res) -> Promise<void>`. Reads capability from `Bearer`; `401` if invalid/expired; `403` if `ro` + write method; rewrites `/do/<rest>` → `${upstream}/<rest>`; forwards via `fetchImpl` with `Authorization: Bearer <PAT>` injected; streams upstream status + body back; `502` on resolve/upstream failure.

- [ ] **Step 1: Write the failing test**

Append to `packages/credential-broker/test/do-proxy.test.mjs`:

```js
// Fake upstream fetch that records the request and returns a canned response.
function mkFetch(record) {
  return async (url, init) => {
    record.url = url;
    record.init = init;
    return {
      status: 200,
      headers: new Map([["content-type", "application/json"]]),
      arrayBuffer: async () => new TextEncoder().encode('{"ok":true}').buffer,
    };
  };
}

test("proxy: 401 when the capability token is invalid", async () => {
  const p = createDoProxy(OPTS);
  const res = mkRes();
  await p.proxy(mkReq({ method: "GET", url: "/do/v2/account", auth: "garbage" }), res);
  assert.equal(res.statusCode, 401);
});

test("proxy: ro capability blocks a write method (403)", async () => {
  const rec = {};
  const p = createDoProxy({ ...OPTS, fetchImpl: mkFetch(rec) });
  const cap = p.signToken({ scope: "ro", exp: 2000, iss: "agenticos-broker" });
  const res = mkRes();
  await p.proxy(mkReq({ method: "POST", url: "/do/v2/droplets", auth: cap }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(rec.url, undefined, "must not reach upstream");
});

test("proxy: injects the real PAT, strips the capability, rewrites the path", async () => {
  const rec = {};
  const p = createDoProxy({ ...OPTS, fetchImpl: mkFetch(rec) });
  const cap = p.signToken({ scope: "ro", exp: 2000, iss: "agenticos-broker" });
  const res = mkRes();
  await p.proxy(mkReq({ method: "GET", url: "/do/v2/droplets?per_page=1", auth: cap }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(rec.url, "https://api.digitalocean.com/v2/droplets?per_page=1");
  assert.equal(rec.init.headers["authorization"], "Bearer dop_v1_PAT");
});

test("proxy: rw capability allows a write method", async () => {
  const rec = {};
  const p = createDoProxy({ ...OPTS, fetchImpl: mkFetch(rec) });
  const cap = p.signToken({ scope: "rw", exp: 2000, iss: "agenticos-broker" });
  const res = mkRes();
  await p.proxy(mkReq({ method: "DELETE", url: "/do/v2/droplets/123", auth: cap }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(rec.init.method, "DELETE");
});

test("proxy: 502 when the PAT cannot be resolved", async () => {
  const p = createDoProxy({ ...OPTS, resolvePat: async () => { throw new Error("1password down"); } });
  const cap = p.signToken({ scope: "ro", exp: 2000, iss: "agenticos-broker" });
  const res = mkRes();
  await p.proxy(mkReq({ method: "GET", url: "/do/v2/account", auth: cap }), res);
  assert.equal(res.statusCode, 502);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/credential-broker && node --test test/do-proxy.test.mjs`
Expected: FAIL — `p.proxy is not a function`.

- [ ] **Step 3: Write minimal implementation**

Inside `createDoProxy`, add `proxy` before the return:

```js
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
```

Change the return to: `return { signToken, verifyToken, mint, proxy };`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/credential-broker && node --test test/do-proxy.test.mjs`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/credential-broker/src/do-proxy.mjs packages/credential-broker/test/do-proxy.test.mjs
git -c commit.gpgsign=false commit -m "feat(credential-broker): DO reverse proxy with PAT injection (Phase 2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Wire the routes into `main.mjs`

**Files:**
- Modify: `packages/credential-broker/src/main.mjs`
- Test: `packages/credential-broker/test/main-dispatch.test.mjs`

**Interfaces:**
- Consumes: `createBroker` (existing), `createDoProxy` (Task 1–3).
- Produces (exported for testing): `createRequestHandler({ brokerHandler, doProxy }) -> (req,res)=>Promise<void>`. Dispatch: `POST /token/digitalocean` → `doProxy.mint`; path `=== "/do"` or starts with `/do/` → `doProxy.proxy`; else → `brokerHandler`. When `doProxy` is null, the two DO routes return `503 {error:"DO proxy not configured"}`.

- [ ] **Step 1: Write the failing test**

Create `packages/credential-broker/test/main-dispatch.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequestHandler } from "../src/main.mjs";

function mkReq(method, url) { return { method, url, headers: {} }; }
function mkRes() {
  return {
    statusCode: undefined, body: undefined, headersSent: false,
    writeHead(c) { this.statusCode = c; this.headersSent = true; },
    end(p) { this.body = p ? JSON.parse(p) : undefined; },
  };
}
const stubProxy = {
  mint: async (_req, res) => { res.writeHead(200, {}); res.end('{"r":"mint"}'); },
  proxy: async (_req, res) => { res.writeHead(200, {}); res.end('{"r":"proxy"}'); },
};

test("routes POST /token/digitalocean to mint", async () => {
  const h = createRequestHandler({ brokerHandler: async () => {}, doProxy: stubProxy });
  const res = mkRes();
  await h(mkReq("POST", "/token/digitalocean"), res);
  assert.equal(res.body.r, "mint");
});

test("routes /do/* to proxy", async () => {
  const h = createRequestHandler({ brokerHandler: async () => {}, doProxy: stubProxy });
  const res = mkRes();
  await h(mkReq("GET", "/do/v2/account"), res);
  assert.equal(res.body.r, "proxy");
});

test("falls through to brokerHandler for other paths", async () => {
  let hit = false;
  const h = createRequestHandler({ brokerHandler: async () => { hit = true; }, doProxy: stubProxy });
  await h(mkReq("GET", "/secret/do_token_scoped"), mkRes());
  assert.equal(hit, true);
});

test("DO routes return 503 when proxy is disabled", async () => {
  const h = createRequestHandler({ brokerHandler: async () => {}, doProxy: null });
  const res = mkRes();
  await h(mkReq("POST", "/token/digitalocean"), res);
  assert.equal(res.statusCode, 503);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/credential-broker && node --test test/main-dispatch.test.mjs`
Expected: FAIL — `createRequestHandler` is not exported (and `main.mjs` runs `main()` on import; Step 3 makes `main()` conditional so importing it for tests doesn't start a server).

- [ ] **Step 3: Write minimal implementation**

Edit `packages/credential-broker/src/main.mjs`. Add the import at the top (next to the existing `createBroker` import):

```js
import { createDoProxy } from "./do-proxy.mjs";
```

Add the exported dispatcher (place above `main`):

```js
/** Compose the DO-proxy routes in front of the broker's secret-serving handler.
 *  Exported for unit testing; `main()` wires the real broker + proxy. */
export function createRequestHandler({ brokerHandler, doProxy }) {
  return async function handler(req, res) {
    const send = (code, obj) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    const { pathname } = new URL(req.url, "http://broker");
    if (pathname === "/token/digitalocean" && req.method === "POST") {
      if (!doProxy) return send(503, { error: "DO proxy not configured" });
      return doProxy.mint(req, res);
    }
    if (pathname === "/do" || pathname.startsWith("/do/")) {
      if (!doProxy) return send(503, { error: "DO proxy not configured" });
      return doProxy.proxy(req, res);
    }
    return brokerHandler(req, res);
  };
}
```

In `main()`, after `const handler = createBroker({...})` (rename the local to `brokerHandler`), build the PAT resolver + proxy and compose. Replace the server-creation block with:

```js
  const brokerHandler = createBroker({ resolve, secretsMap, apiKey, ttlMs });

  // DO proxy (Phase 2): enabled only when the PAT secret is in the map.
  const patName = process.env.DO_PAT_SECRET_NAME || "do_token_scoped";
  let doProxy = null;
  if (secretsMap[patName]) {
    // Small TTL cache so the proxy honors the Families read cap (one read per TTL).
    let patCache = null;
    const resolvePat = async () => {
      if (patCache && patCache.exp > Date.now()) return patCache.v;
      const value = await resolve(secretsMap[patName]);
      patCache = { v: value, exp: Date.now() + ttlMs };
      return value;
    };
    doProxy = createDoProxy({
      apiKey,
      resolvePat,
      signingKey: process.env.BROKER_CAPABILITY_SIGNING_KEY,
      maxTtlMs: Number(process.env.DO_PROXY_MAX_TTL_S || 3600) * 1000,
      defaultTtlMs: Number(process.env.DO_PROXY_DEFAULT_TTL_S || 900) * 1000,
    });
    console.error(`[broker] DO proxy enabled (PAT secret: ${patName})`);
  }

  const handler = createRequestHandler({ brokerHandler, doProxy });

  createServer((req, res) => {
    handler(req, res).catch((err) => {
      console.error(`[broker] handler error: ${err?.stack || err}`);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "internal" }));
      }
    });
  }).listen(port, () => {
    console.error(
      `[broker] listening on :${port} — mode=${mode}, secrets=${Object.keys(secretsMap).length}, ttl=${ttlMs}ms, doProxy=${doProxy ? "on" : "off"}`,
    );
  });
```

Guard the bottom-of-file `main()` call so importing the module for tests does not start a server:

```js
// Only run the server when executed directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/credential-broker && node --test`
Expected: PASS — `broker.test.mjs` (8, unchanged), `do-proxy.test.mjs` (15), `main-dispatch.test.mjs` (4).

- [ ] **Step 5: Commit**

```bash
git add packages/credential-broker/src/main.mjs packages/credential-broker/test/main-dispatch.test.mjs
git -c commit.gpgsign=false commit -m "feat(credential-broker): mount DO proxy routes in main (Phase 2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Terraform env helper `do-broker-env.sh`

**Files:**
- Create: `packages/credential-broker/client/do-broker-env.sh`
- Test: manual (bash syntax + a stubbed-response logic check, shown below)

**Interfaces:**
- Consumes: the broker's `POST /token/digitalocean` (Task 2).
- Produces: prints two `export` lines to stdout — `DIGITALOCEAN_API_URL` and `DIGITALOCEAN_TOKEN` — for `eval`.

- [ ] **Step 1: Write the script**

Create `packages/credential-broker/client/do-broker-env.sh`:

```bash
#!/usr/bin/env bash
# do-broker-env.sh — mint a short-lived DO capability token from the broker and
# print the two env exports Terraform needs. The real PAT never enters the shell.
#
# usage: eval "$(BROKER_URL=… BROKER_API_KEY=… ./client/do-broker-env.sh <ro|rw> [ttl-seconds])"
#   emits:  export DIGITALOCEAN_API_URL="$BROKER_URL/do"
#           export DIGITALOCEAN_TOKEN="<minted capability token>"
# ttl-seconds defaults to the broker's DO_PROXY_DEFAULT_TTL_S; the broker clamps
# it to DO_PROXY_MAX_TTL_S.
set -euo pipefail

scope="${1:-ro}"
ttl="${2:-}"
url="${BROKER_URL:?BROKER_URL is required}"
key="${BROKER_API_KEY:?BROKER_API_KEY is required}"

case "$scope" in ro|rw) ;; *) echo "do-broker-env: scope must be ro or rw" >&2; exit 2 ;; esac

q="scope=${scope}"
[ -n "$ttl" ] && q="${q}&ttl=${ttl}"

resp="$(curl -sS -w $'\n%{http_code}' -X POST \
    -H "Authorization: Bearer ${key}" \
    "${url}/token/digitalocean?${q}")"
code="${resp##*$'\n'}"
body="${resp%$'\n'*}"

if [ "$code" != "200" ]; then
    echo "do-broker-env: mint failed (HTTP $code): $(echo "$body" | tr -d '[:cntrl:]')" >&2
    exit 1
fi

# Extract .token (jq if present, else a portable sed; token has no embedded quote).
if command -v jq >/dev/null 2>&1; then
    token="$(printf '%s' "$body" | jq -r '.token')"
else
    token="$(printf '%s' "$body" | sed -e 's/.*"token":"//' -e 's/".*//')"
fi

printf 'export DIGITALOCEAN_API_URL=%q\n' "${url}/do"
printf 'export DIGITALOCEAN_TOKEN=%q\n' "$token"
```

- [ ] **Step 2: Make it executable and check syntax**

Run:
```bash
chmod +x packages/credential-broker/client/do-broker-env.sh
bash -n packages/credential-broker/client/do-broker-env.sh && echo "syntax ok"
```
Expected: `syntax ok`.

- [ ] **Step 3: Verify the token-extraction logic with a stubbed body**

Run:
```bash
printf '%s' '{"token":"v1.abc.def","scope":"rw","expiresAt":"2026-07-10T00:00:00Z"}' \
  | sed -e 's/.*"token":"//' -e 's/".*//'
```
Expected: `v1.abc.def`

- [ ] **Step 4: Verify the missing-env guard**

Run: `BROKER_URL= BROKER_API_KEY= bash packages/credential-broker/client/do-broker-env.sh ro; echo "exit=$?"`
Expected: stderr `BROKER_URL is required`, `exit=1`.

- [ ] **Step 5: Commit**

```bash
git add packages/credential-broker/client/do-broker-env.sh
git -c commit.gpgsign=false commit -m "feat(credential-broker): do-broker-env.sh terraform helper (Phase 2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Documentation — README proxy section

**Files:**
- Modify: `packages/credential-broker/README.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Add the DO proxy section**

In `packages/credential-broker/README.md`, add after the Endpoints table:

````markdown
## DigitalOcean proxy (Phase 2)

DigitalOcean can't mint short-lived scoped tokens, so the broker fronts the DO API: callers present a short-lived **capability token** and the broker injects the real `do_token_scoped` PAT server-side. The PAT never leaves the broker.

| Method | Path                    | Auth              | Purpose                                   |
|--------|-------------------------|-------------------|-------------------------------------------|
| POST   | `/token/digitalocean`   | `BROKER_API_KEY`  | Mint a capability token (`scope=ro\|rw`, `ttl` s) |
| ALL    | `/do/*`                 | capability token  | Proxy to `api.digitalocean.com` with the PAT |

`ro` capabilities allow only `GET`/`HEAD`; `rw` allows all methods. Tokens are HMAC-signed and expire (default 15 m, cap 60 m).

**Terraform — zero code change:**

```bash
eval "$(BROKER_URL=http://credential-broker:9100 BROKER_API_KEY=… ./client/do-broker-env.sh rw 1200)"
terraform -chdir=infra/terraform apply     # PAT never enters the shell
```

**Config:** `BROKER_CAPABILITY_SIGNING_KEY` (optional; HKDF-derived from `BROKER_API_KEY` if unset), `DO_PAT_SECRET_NAME` (default `do_token_scoped`), `DO_PROXY_DEFAULT_TTL_S` (900), `DO_PROXY_MAX_TTL_S` (3600). The proxy is enabled only when `DO_PAT_SECRET_NAME` is in the secrets map; otherwise `/token/digitalocean` and `/do/*` return `503`.

**Limitation:** scope is coarse (`ro`/`rw`), not per-resource-type. Deferred: per-resource policy, the Paperclip-agent consumer, request audit log.
````

- [ ] **Step 2: Commit**

```bash
git add packages/credential-broker/README.md
git -c commit.gpgsign=false commit -m "docs(credential-broker): DO proxy usage (Phase 2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Full test suite:** `cd packages/credential-broker && node --test` → all pass (broker 8, do-proxy 15, main-dispatch 4).
- [ ] **Manual smoke (operator, own terminal):** with the broker running via `dev-run.sh`, `eval "$(BROKER_URL=http://localhost:9100 BROKER_API_KEY=dev-local-key ./client/do-broker-env.sh ro)"` then `curl -s "$DIGITALOCEAN_API_URL/v2/account" -H "Authorization: Bearer $DIGITALOCEAN_TOKEN" | python3 -c "import json,sys; print('status field present:', 'account' in json.load(sys.stdin))"`. A `ro` capability + the scoped PAT: `/v2/account` returns 401/403 from DO (proof it's the scoped identity), while `/v2/droplets` succeeds. **Do not print token values.**
- [ ] **Open the PR** off `infra/gol-77-do-proxy` → `main`, referencing the spec.

## Out of scope (tracked, not built here)

Per-resource-type scoping / policy engine; the Paperclip-agent consumer (curated command surface); per-identity policy; proxied-call audit log; per-stage (QA/Prod) capability issuance (folds in when the ADR-0001 per-stage vaults exist); switching `load-secrets.sh` / CI to route through the broker (a later change — this plan does not modify the terraform runtime path).
