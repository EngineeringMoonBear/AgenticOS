#!/usr/bin/env node
// GitHub App auth for AgenticOS agents — dependency-free (Node built-ins only).
//
// The agent runs inside paperclip-server (user `node`). This mints short-lived
// (≈1h) GitHub App *installation* tokens on demand and routes them per repo, so
// `git` and `gh` work across every org the App is installed on (EngineeringMoonBear,
// Goldberry-Playground, …) from the App private key alone — no per-owner PATs.
//
// Tokens are scoped to the single repo when the caller supplies one (least
// privilege); only owner-level callers (`token <owner>`) get a whole-installation
// token.
//
// MODES
//   node github-app-token.mjs get                  # git credential helper (reads stdin)
//   node github-app-token.mjs erase                # drop a cached token git just rejected
//   node github-app-token.mjs token <owner>[/<repo>]  # print an installation token (gh/curl)
//
// CONFIG (env)
//   GITHUB_APP_ID                 required, e.g. 4134853
//   GITHUB_APP_PRIVATE_KEY_B64    required, base64 of the App's .pem
//
// Tokens are cached per (owner[/repo]) under $HOME/.cache/agenticos-gh-app/ until
// ~5m before expiry, so back-to-back git calls don't re-mint.

import { createSign } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// GitHub owner/repo grammars. Validating before the value touches a URL or a
// file path closes path-traversal and request-tampering — values originate from
// git stdin / argv.
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

// Trim: a stray newline from an .env / 1Password round-trip would otherwise make
// iss="4134853\n" (invalid JWT → silent auth failure).
const APP_ID = (process.env.GITHUB_APP_ID || "").trim();
const KEY_B64 = (process.env.GITHUB_APP_PRIVATE_KEY_B64 || "").trim();
const API = "https://api.github.com";
const CACHE_DIR = join(process.env.HOME || homedir(), ".cache", "agenticos-gh-app");

const log = (m) => process.stderr.write(`[github-app-token] ${m}\n`);
const die = (m) => { log(m); process.exit(1); };
const configured = () => Boolean(APP_ID && KEY_B64);

// 1Password (and some env-file round-trips) collapse a PEM's line breaks, leaving
// BEGIN/END + body on one line — which Node's crypto rejects ("DECODER routines::
// unsupported"). Rebuild the canonical PEM (markers on their own lines, body
// wrapped at 64 cols). The key MATERIAL is intact; only the framing is restored.
function normalizePem(s) {
  const m = s.match(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/);
  if (!m) return s; // not a PEM we recognize — let crypto try it as-is
  const wrapped = m[2].replace(/\s+/g, "").match(/.{1,64}/g);
  if (!wrapped) return s; // empty body — let crypto surface a clear error
  const label = m[1].trim();
  return `-----BEGIN ${label}-----\n${wrapped.join("\n")}\n-----END ${label}-----\n`;
}

function appJwt() {
  const pem = normalizePem(Buffer.from(KEY_B64, "base64").toString("utf8"));
  const now = Math.floor(Date.now() / 1000);
  const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  // iat backdated 60s for clock skew; exp must be ≤10m per GitHub.
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
    // Status + path only — NOT the response body. This message is logged to
    // agent-visible stderr; the body would disclose installation IDs / org
    // metadata. The path (e.g. /orgs/Acme/installation -> 404) is self-explanatory.
    const err = new Error(`${opts.method || "GET"} ${path} -> ${res.status}`);
    err.status = res.status;
    await res.body?.cancel?.();
    throw err;
  }
  return res.json();
}

function validateTarget(owner, repo) {
  if (!OWNER_RE.test(owner)) throw new Error(`invalid GitHub owner: '${owner}'`);
  if (repo && !REPO_RE.test(repo)) throw new Error(`invalid GitHub repo: '${repo}'`);
}

function cacheFileFor(owner, repo) {
  // owner/repo are already validated (no '/'), so this is a single safe filename.
  const key = (repo ? `${owner}--${repo}` : owner).toLowerCase();
  return join(CACHE_DIR, `${key}.json`);
}

async function installationToken(owner, repo) {
  validateTarget(owner, repo);
  const cacheFile = cacheFileFor(owner, repo);
  // Read-then-catch (no existsSync pre-check) avoids a check-then-use race.
  try {
    const c = JSON.parse(readFileSync(cacheFile, "utf8"));
    if (c.token && c.expires_at && Date.parse(c.expires_at) - Date.now() > 5 * 60 * 1000) {
      return c.token;
    }
  } catch { /* missing/stale/corrupt cache — re-mint below */ }
  const jwt = appJwt();
  // The App may be installed on an org OR a user account — try both.
  let inst;
  try {
    inst = await api(`/orgs/${owner}/installation`, jwt);
  } catch (e) {
    if (e.status === 404) inst = await api(`/users/${owner}/installation`, jwt);
    else throw e;
  }
  // Least privilege: scope the token to the single repo when known; only
  // owner-level callers get a whole-installation token.
  const opts = repo
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repositories: [repo] }) }
    : { method: "POST" };
  const tok = await api(`/app/installations/${inst.id}/access_tokens`, jwt, opts);
  try {
    mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(cacheFile, JSON.stringify(tok), { mode: 0o600 });
  } catch { /* cache is best-effort */ }
  return tok.token;
}

// Parse a git credential request from stdin into {owner, repo}. With
// credential.useHttpPath=true git supplies path=owner/repo[.git].
function targetFromStdin() {
  const p = {};
  for (const line of readFileSync(0, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) p[line.slice(0, i)] = line.slice(i + 1);
  }
  if (p.host !== "github.com") return null; // not ours
  const [owner, repoRaw] = (p.path || "").split("/");
  if (!owner) return null;
  return { owner, repo: (repoRaw || "").replace(/\.git$/, "") || undefined };
}

async function credentialGet() {
  const t = targetFromStdin();
  if (!t || !configured()) return; // not ours / unconfigured — emit nothing, git falls back
  const token = await installationToken(t.owner, t.repo);
  process.stdout.write(`username=x-access-token\npassword=${token}\n`);
}

// git calls `erase` when a supplied credential was rejected — drop the cached
// token so the next `get` re-mints (handles installation tokens revoked early by
// a permissions change / reinstall, which would otherwise be served until expiry).
function credentialErase() {
  const t = targetFromStdin();
  if (!t) return;
  try { validateTarget(t.owner, t.repo); rmSync(cacheFileFor(t.owner, t.repo), { force: true }); } catch { /* best-effort */ }
}

const mode = process.argv[2];
try {
  if (mode === "get") {
    await credentialGet();
  } else if (mode === "erase") {
    credentialErase();
  } else if (mode === "store") {
    // nothing to persist — tokens are minted on demand
  } else if (mode === "token") {
    if (!configured()) die("GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY_B64 not set");
    const [owner, repo] = (process.argv[3] || "").split("/");
    if (!owner) die("usage: github-app-token.mjs token <owner>[/<repo>]");
    process.stdout.write(`${await installationToken(owner, repo || undefined)}\n`);
  } else {
    die(`unknown mode '${mode}'. Use: get | erase | token <owner>[/<repo>]`);
  }
} catch (e) {
  // In credential 'get' mode, failing silently lets git surface its own auth
  // error; in 'token' mode the message matters.
  if (mode === "token") die(e.message);
  log(e.message);
  process.exit(0);
}
