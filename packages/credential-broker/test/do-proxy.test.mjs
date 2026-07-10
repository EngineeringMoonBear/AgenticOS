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
