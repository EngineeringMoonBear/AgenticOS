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
