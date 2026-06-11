import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "agenticos.vault-plugin",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Vault",
  description:
    "Obsidian vault integration — read-only knowledge access + inbox archival",
  author: "AgenticOS",
  categories: ["connector"],
  capabilities: ["projects.managed"],
  entrypoints: {
    worker: "./dist/worker.js",
  },
};

export default manifest;
