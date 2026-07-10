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
