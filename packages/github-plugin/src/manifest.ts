import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "agenticos.github-plugin",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "GitHub",
  description: "Read-only GitHub PR triage — daily digest of open PRs",
  author: "AgenticOS",
  categories: ["connector"],
  // secrets.read-ref lets the worker resolve the configured GitHub token; the
  // token itself is supplied by the operator via plugin settings (never env —
  // Paperclip sandboxes workers away from the host process env).
  capabilities: ["jobs.schedule", "http.outbound", "secrets.read-ref"],
  jobs: [
    {
      jobKey: "pr-triage",
      displayName: "PR Triage",
      description: "Daily digest of open PRs across the org",
      schedule: "30 7 * * *",
    },
  ],
  instanceConfigSchema: {
    type: "object",
    properties: {
      githubToken: {
        type: "string",
        format: "secret-ref",
        title: "GitHub Token",
        description:
          "Fine-grained read-only PAT (Contents, Pull requests, Checks, Metadata). Paste the value here; it is stored as a secret.",
      },
      org: {
        type: "string",
        title: "GitHub Org",
        description: "Org to triage open PRs across.",
        default: "EngineeringMoonBear",
      },
      staleDays: {
        type: "integer",
        title: "Stale after (days)",
        description: "Open PRs older than this are flagged stale.",
        default: 7,
      },
      vaultPath: {
        type: "string",
        title: "Digest vault path",
        description: "Vault path the digest is written to.",
        default: "wiki/_meta/dev-pr-digest.md",
      },
      vaultServerUrl: {
        type: "string",
        title: "Vault server URL",
        description: "Internal URL of the vault-server write endpoint.",
        default: "http://vault-server:7777",
      },
    },
    required: ["githubToken"],
  },
  entrypoints: {
    worker: "./dist/worker.js",
  },
};

export default manifest;
