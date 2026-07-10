// Unit tests for the pure broker. No SDK, no network — the resolver is a stub
// and the clock is injected, so cache/TTL behavior is deterministic.
//   run: node --test   (from packages/credential-broker)

import { test } from "node:test";
import assert from "node:assert/strict";
import { createBroker } from "../src/broker.mjs";

const API_KEY = "test-key-123";
const MAP = { do_token: "op://vault/item/do", cf_token: "op://vault/item/cf" };

/** Drive the handler with a fake req/res; return { status, body }. */
async function call(handler, { method = "GET", path = "/", auth = API_KEY } = {}) {
  const headers = {};
  if (auth) headers["authorization"] = `Bearer ${auth}`;
  const req = { method, url: path, headers };
  let status, body;
  const res = {
    headersSent: false,
    writeHead(code) {
      status = code;
      this.headersSent = true;
    },
    end(payload) {
      body = payload ? JSON.parse(payload) : undefined;
    },
  };
  await handler(req, res);
  return { status, body };
}

test("health is unauthenticated and reports counts", async () => {
  const handler = createBroker({ resolve: async () => "x", secretsMap: MAP, apiKey: API_KEY });
  const { status, body } = await call(handler, { path: "/health", auth: null });
  assert.equal(status, 200);
  assert.equal(body.status, "ok");
  assert.equal(body.secrets, 2);
});

test("missing/wrong bearer → 401", async () => {
  const handler = createBroker({ resolve: async () => "x", secretsMap: MAP, apiKey: API_KEY });
  assert.equal((await call(handler, { path: "/secret/do_token", auth: null })).status, 401);
  assert.equal((await call(handler, { path: "/secret/do_token", auth: "wrong" })).status, 401);
});

test("allowlisted secret resolves and is returned", async () => {
  let calls = 0;
  const handler = createBroker({
    resolve: async (ref) => {
      calls++;
      return `resolved:${ref}`;
    },
    secretsMap: MAP,
    apiKey: API_KEY,
  });
  const { status, body } = await call(handler, { path: "/secret/do_token" });
  assert.equal(status, 200);
  assert.equal(body.value, "resolved:op://vault/item/do");
  assert.equal(body.cached, false);
  assert.equal(calls, 1);
});

test("unknown secret name → 404, never hits resolver", async () => {
  let calls = 0;
  const handler = createBroker({
    resolve: async () => {
      calls++;
      return "x";
    },
    secretsMap: MAP,
    apiKey: API_KEY,
  });
  const { status } = await call(handler, { path: "/secret/not_allowed" });
  assert.equal(status, 404);
  assert.equal(calls, 0, "allowlist must gate before the resolver");
});

test("second read is a cache hit — one upstream read for N calls", async () => {
  let calls = 0;
  const handler = createBroker({
    resolve: async () => {
      calls++;
      return "v";
    },
    secretsMap: MAP,
    apiKey: API_KEY,
    ttlMs: 10_000,
    now: () => 1000,
  });
  const a = await call(handler, { path: "/secret/do_token" });
  const b = await call(handler, { path: "/secret/do_token" });
  assert.equal(a.body.cached, false);
  assert.equal(b.body.cached, true);
  assert.equal(calls, 1, "cache must serve the second call");
});

test("cache expires after TTL and re-reads upstream", async () => {
  let calls = 0;
  let clock = 1000;
  const handler = createBroker({
    resolve: async () => {
      calls++;
      return "v";
    },
    secretsMap: MAP,
    apiKey: API_KEY,
    ttlMs: 5_000,
    now: () => clock,
  });
  await call(handler, { path: "/secret/do_token" }); // read @1000, expires @6000
  clock = 6001;
  const after = await call(handler, { path: "/secret/do_token" });
  assert.equal(after.body.cached, false);
  assert.equal(calls, 2, "expired entry must re-read");
});

test("resolver failure → 502 (not cached)", async () => {
  let fail = true;
  const handler = createBroker({
    resolve: async () => {
      if (fail) throw new Error("1password down");
      return "v";
    },
    secretsMap: MAP,
    apiKey: API_KEY,
  });
  const bad = await call(handler, { path: "/secret/do_token" });
  assert.equal(bad.status, 502);
  fail = false;
  const good = await call(handler, { path: "/secret/do_token" });
  assert.equal(good.status, 200, "a failed resolve must not poison the cache");
});

test("constructor validates required args", () => {
  assert.throws(() => createBroker({ resolve: async () => "x", secretsMap: MAP }), /apiKey/);
  assert.throws(() => createBroker({ resolve: async () => "x", apiKey: "k" }), /secretsMap/);
  assert.throws(() => createBroker({ secretsMap: MAP, apiKey: "k" }), /resolve/);
});
