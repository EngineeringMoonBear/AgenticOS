// Entry point — wires the pure broker (broker.mjs) to a real resolver and an
// http server. Two resolver backends, chosen by environment:
//
//   • 1Password machine identity (prod/QA): OP_SERVICE_ACCOUNT_TOKEN is set →
//     resolve op:// refs through the official @1password/sdk. SECRETS_MAP_FILE
//     is the allowlist (name -> op:// ref). This is the ADR-0001 backing token.
//   • Local mode (OrbStack dev): no SA token → LOCAL_SECRETS_FILE (name -> value)
//     is served directly, so a laptop runs the broker without a real token or a
//     1Password round-trip. Loudly flagged; never use in a deployed environment.
//
// The SDK is imported dynamically so unit tests (and local mode) run without the
// dependency installed.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createBroker } from "./broker.mjs";

function fatal(msg) {
  console.error(`[broker] FATAL: ${msg}`);
  process.exit(1);
}

function loadJson(path, what) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    fatal(`could not read ${what} at ${path}: ${err.message}`);
  }
}

async function buildResolver() {
  const token = process.env.OP_SERVICE_ACCOUNT_TOKEN;
  if (token) {
    const mapFile = process.env.SECRETS_MAP_FILE || "/app/secrets-map.json";
    const secretsMap = loadJson(mapFile, "secrets map");
    // Dynamic import: keeps the SDK out of the test/local path.
    const { createClient } = await import("@1password/sdk");
    const client = await createClient({
      auth: token,
      integrationName: "AgenticOS Credential Broker",
      integrationVersion: "1.0.0",
    });
    return {
      secretsMap,
      resolve: (ref) => client.secrets.resolve(ref),
      mode: "1password-service-account",
    };
  }

  const localFile = process.env.LOCAL_SECRETS_FILE;
  if (localFile) {
    const local = loadJson(localFile, "local secrets");
    console.warn(
      "[broker] ⚠ LOCAL MODE — serving dev values from LOCAL_SECRETS_FILE, NOT 1Password. Never use in a deployed env.",
    );
    // The broker passes secretsMap[name] to resolve(); in local mode the "ref"
    // is just the name and resolve() looks it up in the dev file.
    const secretsMap = Object.fromEntries(Object.keys(local).map((k) => [k, k]));
    return {
      secretsMap,
      resolve: async (name) => {
        if (!(name in local)) throw new Error(`no local secret '${name}'`);
        return local[name];
      },
      mode: "local-dev",
    };
  }

  fatal(
    "no backend: set OP_SERVICE_ACCOUNT_TOKEN (+ SECRETS_MAP_FILE) for 1Password, or LOCAL_SECRETS_FILE for dev.",
  );
}

async function main() {
  const apiKey = process.env.BROKER_API_KEY;
  if (!apiKey) fatal("BROKER_API_KEY is required (callers authenticate with it).");

  const port = Number(process.env.PORT || 9100);
  const ttlMs = Number(process.env.CACHE_TTL_MS || 60 * 60 * 1000);

  const { secretsMap, resolve, mode } = await buildResolver();
  const handler = createBroker({ resolve, secretsMap, apiKey, ttlMs });

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
      `[broker] listening on :${port} — mode=${mode}, secrets=${Object.keys(secretsMap).length}, ttl=${ttlMs}ms`,
    );
  });
}

main();
