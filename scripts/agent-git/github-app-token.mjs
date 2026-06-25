#!/usr/bin/env node
// GitHub App auth for AgenticOS agents — dependency-free (Node built-ins only).
//
// Two deployment shapes, one file:
//
//   1. TOKEN BROKER (gh-token-broker container) — `serve` mode. Holds the App
//      private key (GITHUB_APP_PRIVATE_KEY_B64) and exposes an internal HTTP
//      endpoint that mints short-lived, repo-scoped installation tokens. This is
//      the ONLY place the key lives.
//
//   2. CREDENTIAL HELPER (inside paperclip-server, run as `node`) — `get`/`token`
//      modes. When GH_TOKEN_BROKER_URL is set it asks the broker for a token over
//      the compose network; it never has the key. So a prompt-injected agent that
//      reads the container env cannot exfiltrate the App private key — only the
//      ability to request scoped tokens (its job anyway).
//
//   (Back-compat: with no GH_TOKEN_BROKER_URL but a key present, get/token mint
//    locally — the original single-process behaviour.)
//
// MODES
//   node github-app-token.mjs serve                    # run the broker (needs the key)
//   node github-app-token.mjs get                      # git credential helper (stdin)
//   node github-app-token.mjs erase                    # drop a cached token git rejected
//   node github-app-token.mjs token <owner>[/<repo>]   # print a token (gh/curl)
//
// CONFIG (env)
//   serve:   GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY_B64, PORT (default 9099)
//   helper:  GH_TOKEN_BROKER_URL (e.g. http://gh-token-broker:9099)
//            — or, back-compat, GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY_B64

import { createServer } from "node:http";
import { createSign } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

const APP_ID = (process.env.GITHUB_APP_ID || "").trim();
const KEY_B64 = (process.env.GITHUB_APP_PRIVATE_KEY_B64 || "").trim();
const BROKER_URL = (process.env.GH_TOKEN_BROKER_URL || "").trim().replace(/\/$/, "");
const API = "https://api.github.com";
const CACHE_DIR = join(process.env.HOME || homedir(), ".cache", "agenticos-gh-app");

const log = (m) => process.stderr.write(`[github-app-token] ${m}\n`);
const die = (m) => { log(m); process.exit(1); };
const canMintLocally = () => Boolean(APP_ID && KEY_B64);

function validateTarget(owner, repo) {
  if (!OWNER_RE.test(owner)) throw new Error(`invalid GitHub owner: '${owner}'`);
  if (repo && !REPO_RE.test(repo)) throw new Error(`invalid GitHub repo: '${repo}'`);
}

// --- local minting (broker + back-compat) ---------------------------------

function normalizePem(s) {
  const m = s.match(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/);
  if (!m) return s;
  const wrapped = m[2].replace(/\s+/g, "").match(/.{1,64}/g);
  if (!wrapped) return s;
  const label = m[1].trim();
  return `-----BEGIN ${label}-----\n${wrapped.join("\n")}\n-----END ${label}-----\n`;
}

function appJwt() {
  const pem = normalizePem(Buffer.from(KEY_B64, "base64").toString("utf8"));
  const now = Math.floor(Date.now() / 1000);
  const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64url({ alg: "RS256", typ: "JWT" });
  const body = b64url({ iat: now - 60, exp: now + 540, iss: APP_ID });
  const signer = createSign("RSA-SHA256");
  signer.update(`${head}.${body}`);
  return `${head}.${body}.${signer.sign(pem, "base64url")}`;
}

async function api(path, token, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "agenticos-github-app",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const err = new Error(`${opts.method || "GET"} ${path} -> ${res.status}`); // status only, no body
    err.status = res.status;
    await res.body?.cancel?.();
    throw err;
  }
  return res.json();
}

function cacheFileFor(owner, repo) {
  const key = (repo ? `${owner}--${repo}` : owner).toLowerCase();
  return join(CACHE_DIR, `${key}.json`);
}

async function mintLocal(owner, repo) {
  validateTarget(owner, repo);
  const cacheFile = cacheFileFor(owner, repo);
  try {
    const c = JSON.parse(readFileSync(cacheFile, "utf8"));
    if (c.token && c.expires_at && Date.parse(c.expires_at) - Date.now() > 5 * 60 * 1000) return c.token;
  } catch { /* missing/stale — re-mint */ }
  const jwt = appJwt();
  let inst;
  try {
    inst = await api(`/orgs/${owner}/installation`, jwt);
  } catch (e) {
    if (e.status === 404) inst = await api(`/users/${owner}/installation`, jwt);
    else throw e;
  }
  const opts = repo
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repositories: [repo] }) }
    : { method: "POST" };
  const tok = await api(`/app/installations/${inst.id}/access_tokens`, jwt, opts);
  try {
    mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(cacheFile, JSON.stringify(tok), { mode: 0o600 });
  } catch { /* best-effort */ }
  return tok.token;
}

// --- broker client (helper side) ------------------------------------------

async function mintViaBroker(owner, repo) {
  validateTarget(owner, repo);
  const u = new URL(`${BROKER_URL}/token`);
  u.searchParams.set("owner", owner);
  if (repo) u.searchParams.set("repo", repo);
  const res = await fetch(u, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`token broker -> ${res.status}`);
  const { token } = await res.json();
  if (!token) throw new Error("token broker returned no token");
  return token;
}

// Helper dispatch: broker if configured, else local (back-compat).
const mintToken = (owner, repo) => (BROKER_URL ? mintViaBroker(owner, repo) : mintLocal(owner, repo));

// --- git credential helper modes ------------------------------------------

function targetFromStdin() {
  const p = {};
  for (const line of readFileSync(0, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) p[line.slice(0, i)] = line.slice(i + 1);
  }
  if (p.host !== "github.com") return null;
  const [owner, repoRaw] = (p.path || "").split("/");
  if (!owner) return null;
  return { owner, repo: (repoRaw || "").replace(/\.git$/, "") || undefined };
}

async function credentialGet() {
  const t = targetFromStdin();
  if (!t || (!BROKER_URL && !canMintLocally())) return; // unconfigured — git falls back
  const token = await mintToken(t.owner, t.repo);
  process.stdout.write(`username=x-access-token\npassword=${token}\n`);
}

function credentialErase() {
  const t = targetFromStdin();
  if (!t) return;
  try { validateTarget(t.owner, t.repo); rmSync(cacheFileFor(t.owner, t.repo), { force: true }); } catch { /* best-effort */ }
}

// --- broker server mode ---------------------------------------------------

function serve() {
  if (!canMintLocally()) die("serve mode requires GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY_B64");
  const port = Number(process.env.PORT || 9099);
  createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://broker");
      if (url.pathname === "/health") { res.writeHead(200).end("ok"); return; }
      if (req.method !== "GET" || url.pathname !== "/token") { res.writeHead(404).end(); return; }
      const owner = url.searchParams.get("owner") || "";
      const repo = url.searchParams.get("repo") || undefined;
      const token = await mintLocal(owner, repo); // validates owner/repo
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ token }));
    } catch (e) {
      // Log status/path only; never the key or API bodies.
      log(e.message);
      res.writeHead(e.status === 404 ? 404 : 400, { "Content-Type": "application/json" })
        .end(JSON.stringify({ error: "mint_failed" }));
    }
  }).listen(port, () => log(`token broker listening on :${port}`));
}

// --- entry ----------------------------------------------------------------

const mode = process.argv[2];
try {
  if (mode === "serve") {
    serve();
  } else if (mode === "get") {
    await credentialGet();
  } else if (mode === "erase") {
    credentialErase();
  } else if (mode === "store") {
    // nothing to persist — tokens are minted on demand
  } else if (mode === "token") {
    if (!BROKER_URL && !canMintLocally()) die("set GH_TOKEN_BROKER_URL (or GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY_B64)");
    const [owner, repo] = (process.argv[3] || "").split("/");
    if (!owner) die("usage: github-app-token.mjs token <owner>[/<repo>]");
    process.stdout.write(`${await mintToken(owner, repo || undefined)}\n`);
  } else {
    die(`unknown mode '${mode}'. Use: serve | get | erase | token <owner>[/<repo>]`);
  }
} catch (e) {
  if (mode === "token") die(e.message);
  log(e.message);
  process.exit(0);
}
