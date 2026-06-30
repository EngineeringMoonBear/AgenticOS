import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "agenticos.github-sync-plugin",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "GitHub Sync",
  description:
    "Mirror Paperclip issue changes to GitHub issues (Paperclip → GitHub, one direction)",
  author: "AgenticOS",
  categories: ["connector"],
  // events.subscribe: the worker subscribes to core "issue.created" / "issue.updated".
  // http.outbound: the github-client writes issues to the GitHub REST API.
  // database.namespace.{read,write,migrate}: a "github_sync_mapping" table in the
  //   plugin DB namespace links paperclip_issue_id <-> github repo#number and records
  //   sync origin for loop prevention. The table is created with an idempotent
  //   CREATE TABLE IF NOT EXISTS (gated behind database.namespace.migrate).
  // issues.read: REQUIRED and added beyond the original spec list. The plugin event
  //   payload for issue.created/issue.updated is delta-based (the activity-log
  //   `details` blob — title/identifier/changed-fields), NOT the full Issue object,
  //   and notably does NOT carry the description on create. To build the GitHub
  //   issue body (title + description + status) the handler reads the full issue
  //   back via ctx.issues.get(event.entityId, event.companyId), which the host
  //   gates behind issues.read. See vendor/paperclip/server/src/services/activity-log.ts.
  capabilities: [
    "events.subscribe",
    "http.outbound",
    "issues.read",
    "database.namespace.read",
    "database.namespace.write",
    "database.namespace.migrate",
  ],
  instanceConfigSchema: {
    type: "object",
    properties: {
      githubToken: {
        type: "string",
        title: "GitHub Token",
        description:
          "Write-scoped GitHub PAT used to create/update issues. Stored in plugin config.",
      },
      githubOrg: {
        type: "string",
        title: "GitHub Org",
        description: "GitHub organization/owner that owns the target repository.",
        default: "EngineeringMoonBear",
      },
      githubRepo: {
        type: "string",
        title: "GitHub Repo",
        description:
          "Target repository name (without owner). Native Paperclip issues are mirrored here.",
      },
      paperclipProjectId: {
        type: "string",
        title: "Paperclip Project ID",
        description:
          "ONLY issues in this Paperclip project are mirrored to GitHub. Required — the worker refuses to subscribe company-wide, so unrelated work (e.g. QA-triage issues in other projects) is never mirrored. This is the project that bridges to githubRepo.",
      },
      syncLabelPaperclip: {
        type: "string",
        title: "Paperclip → GitHub label",
        description: "Label applied to GitHub issues created from Paperclip issues.",
        default: "synced-from-paperclip",
      },
      syncMarkerGithub: {
        type: "string",
        title: "GitHub → Paperclip marker label",
        description:
          "Label that marks issues that originated in GitHub (set by the inbound routine).",
        default: "synced-from-github",
      },
    },
    required: ["githubToken", "githubRepo", "paperclipProjectId"],
  },
  // Event-driven only — no scheduled jobs.
  entrypoints: {
    worker: "./dist/worker.js",
  },
};

export default manifest;
