// src/manifest.ts
var manifest = {
  id: "agenticos.openviking-plugin",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "OpenViking Memory",
  description: "Agent semantic memory \u2014 remember, recall, find, and abstract",
  author: "AgenticOS",
  categories: ["connector"],
  // http.outbound: the worker's client calls the OpenViking HTTP API.
  // The API key is a plain config value (supplied by the operator via plugin
  // settings — workers can't read host env). NOT a secret-ref: the plugin
  // secret-resolution path is disabled in Paperclip 2026.609.0. Migrate to
  // format:"secret-ref" + secrets.read-ref once company-scoped config lands.
  // database.namespace.read/write: vault-ingest job persists SHA reconciliation
  // state in a plugin DB namespace to avoid re-ingesting unchanged files.
  // database.namespace.migrate: the job runs `CREATE TABLE IF NOT EXISTS
  // vault_ingest_state` (idempotent DDL) on each run instead of a formal
  // migration, which the host gates behind this capability.
  capabilities: [
    "jobs.schedule",
    "http.outbound",
    "database.namespace.read",
    "database.namespace.write",
    "database.namespace.migrate"
  ],
  jobs: [
    {
      jobKey: "vault-ingest",
      displayName: "Vault Ingest",
      description: "Hourly sync of vault markdown files into OpenViking semantic memory",
      schedule: "0 * * * *"
    }
  ],
  instanceConfigSchema: {
    type: "object",
    properties: {
      apiKey: {
        type: "string",
        title: "OpenViking API Key",
        description: "Root API key for the OpenViking server. Stored in plugin config; set via the secret-sync script, not by hand."
      },
      endpoint: {
        type: "string",
        title: "OpenViking Endpoint",
        description: "Internal URL of the OpenViking server.",
        default: "http://openviking:1933"
      },
      account: {
        type: "string",
        title: "Account",
        default: "agenticos"
      },
      user: {
        type: "string",
        title: "User",
        default: "deploy"
      },
      vaultServerUrl: {
        type: "string",
        title: "Vault server URL",
        default: "http://vault-server:7777"
      }
    },
    required: ["apiKey"]
  },
  entrypoints: {
    worker: "./dist/worker.js"
  }
};
var manifest_default = manifest;
export {
  manifest_default as default
};
