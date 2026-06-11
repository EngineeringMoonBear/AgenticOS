import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "agenticos.github-plugin",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "GitHub",
  description: "Read-only GitHub PR triage — daily digest of open PRs",
  author: "AgenticOS",
  categories: ["connector"],
  capabilities: ["jobs.schedule", "http.outbound"],
  jobs: [
    {
      jobKey: "pr-triage",
      displayName: "PR Triage",
      description: "Daily digest of open PRs across the org",
      schedule: "30 7 * * *",
    },
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
};

export default manifest;
