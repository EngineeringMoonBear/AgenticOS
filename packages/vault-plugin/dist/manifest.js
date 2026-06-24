// src/manifest.ts
var manifest = {
  id: "agenticos.vault-plugin",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Vault",
  description: "Obsidian vault integration \u2014 read-only knowledge access + inbox archival",
  author: "AgenticOS",
  categories: ["connector"],
  capabilities: ["projects.managed"],
  // No secret: vault-server is reached over the internal compose network and
  // is unauthenticated. The URL is operator-configurable with a working default.
  instanceConfigSchema: {
    type: "object",
    properties: {
      vaultServerUrl: {
        type: "string",
        title: "Vault server URL",
        description: "Internal URL of the vault-server.",
        default: "http://vault-server:7777"
      }
    }
  },
  entrypoints: {
    worker: "./dist/worker.js"
  }
};
var manifest_default = manifest;
export {
  manifest_default as default
};
