#!/usr/bin/env node
// GitHub App auth for AgenticOS agents — dependency-free (Node built-ins only).
//
// The agent runs inside paperclip-server (user `node`). This mints short-lived
// (≈1h) GitHub App *installation* tokens on demand and routes them per repo
// owner, so `git` and `gh` work across every org the App is installed on
// (EngineeringMoonBear, Goldberry-Playground, …) with ONE credential — the App
// private key — instead of a per-owner pile of PATs.
//
// MODES
//   node github-app-token.mjs get            # git credential helper (reads stdin)
//   node github-app-token.mjs token <owner>  # print an installation token (for gh/curl)
//
// CONFIG (env)
//   GITHUB_APP_ID                 required, e.g. 4134853
//   GITHUB_APP_PRIVATE_KEY_B64    required, base64 of the App's .pem
//     (base64 keeps the multi-line PEM as a single .env line; the key never
//      leaves the container, and tokens it mints are App-scoped + auto-expiring)
//
// Tokens are cached per owner under $HOME/.cache/agenticos-gh-app/ until ~5m
// before expiry, so back-to-back git calls don't re-mint.

import { createSign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// GitHub owners (orgs/users) are 1–39 chars of [A-Za-z0-9-]. Validating against
// this before the value touches a URL or a file path closes path-traversal
// (e.g. "../") and request-tampering — the value originates from git stdin/argv.
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

const APP_ID = process.env.GITHUB_APP_ID;
const KEY_B64 = process.env.GITHUB_APP_PRIVATE_KEY_B64;
const API = "https://api.github.com";
const CACHE_DIR = join(process.env.HOME || homedir(), ".cache", "agenticos-gh-app");

const log = (m) => process.stderr.write(`[github-app-token] ${m}\n`);
const die = (m) => { log(m); process.exit(1); };

function configured() {
  return Boolean(APP_ID && KEY_B64);
}

function appJwt() {
  const pem = Buffer.from(KEY_B64, "base64").toString("utf8");
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
    const err = new Error(`${opts.method || "GET"} ${path} -> ${res.status} ${await res.text()}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function installationToken(owner) {
  if (!OWNER_RE.test(owner)) throw new Error(`invalid GitHub owner: '${owner}'`);
  const cacheFile = join(CACHE_DIR, `${owner.toLowerCase()}.json`);
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
  const tok = await api(`/app/installations/${inst.id}/access_tokens`, jwt, { method: "POST" });
  try {
    mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(cacheFile, JSON.stringify(tok), { mode: 0o600 });
  } catch { /* cache is best-effort */ }
  return tok.token;
}

async function credentialGet() {
  // git feeds key=value lines on stdin; with credential.useHttpPath=true we get path=owner/repo[.git]
  const input = readFileSync(0, "utf8");
  const p = {};
  for (const line of input.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) p[line.slice(0, i)] = line.slice(i + 1);
  }
  if (p.host !== "github.com") return; // not ours — emit nothing, git tries other helpers
  const owner = (p.path || "").split("/")[0];
  if (!owner) return;
  if (!configured()) return; // no App config — degrade silently so git can fall back
  const token = await installationToken(owner);
  process.stdout.write(`username=x-access-token\npassword=${token}\n`);
}

const mode = process.argv[2];
try {
  if (mode === "get") {
    await credentialGet();
  } else if (mode === "store" || mode === "erase") {
    // nothing to persist — tokens are minted on demand
  } else if (mode === "token") {
    if (!configured()) die("GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY_B64 not set");
    const owner = (process.argv[3] || "").split("/")[0];
    if (!owner) die("usage: github-app-token.mjs token <owner>[/<repo>]");
    process.stdout.write(`${await installationToken(owner)}\n`);
  } else {
    die(`unknown mode '${mode}'. Use: get | token <owner>`);
  }
} catch (e) {
  // In credential 'get' mode, failing silently lets git surface its own auth
  // error; in 'token' mode the message matters.
  if (mode === "token") die(e.message);
  log(e.message);
  process.exit(0);
}
