import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "agenticos.github-sync-plugin",
  apiVersion: 1,
  version: "0.3.0",
  displayName: "GitHub Sync",
  description:
    "Mirror Paperclip issue changes to GitHub issues (Paperclip → GitHub). Supports multiple repo↔project bridges across orgs; authenticates via the gh-token-broker (GitHub App), no static PAT.",
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
  // Declaring `database` is REQUIRED for the host to provision + activate the
  // plugin's Postgres namespace (without it, ensureNamespace returns null and the
  // worker fails with "namespace is not active"). migrationsDir → migrations/001_init.sql
  // creates the github_sync_mapping table (runtime DDL via ctx.db.execute is
  // forbidden by the host contract, so the table MUST come from a migration).
  database: {
    namespaceSlug: "github_sync",
    migrationsDir: "migrations",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      bridges: {
        type: "array",
        title: "Repo ↔ Project bridges",
        description:
          "Each entry mirrors one GitHub repo to one Paperclip project. ONLY issues in a bridge's project are mirrored to its repo — the worker refuses to subscribe company-wide, so unrelated work (e.g. QA-triage issues in other projects) is never mirrored. Add one entry per repo you want synced; they may span multiple orgs (the gh-token-broker mints a token per repo).",
        items: {
          type: "object",
          properties: {
            githubOrg: {
              type: "string",
              title: "GitHub Org/Owner",
              description: "Owner of the target repository.",
              default: "EngineeringMoonBear",
            },
            githubRepo: {
              type: "string",
              title: "GitHub Repo (no owner)",
              description: "Target repository name. Native Paperclip issues are mirrored here.",
            },
            paperclipProjectId: {
              type: "string",
              title: "Paperclip Project ID",
              description: "The project that bridges to githubRepo. Must equal the inbound routine's projectId.",
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
              description: "Label marking issues that originated in GitHub (set by the inbound routine).",
              default: "synced-from-github",
            },
          },
          required: ["githubOrg", "githubRepo", "paperclipProjectId"],
        },
      },
      tokenBrokerUrl: {
        type: "string",
        title: "Token Broker URL",
        description:
          "gh-token-broker endpoint that mints repo-scoped GitHub App installation tokens. Defaults to the GH_TOKEN_BROKER_URL env var; set to http://gh-token-broker:9099 if the env is not passed to plugin workers.",
      },
      githubToken: {
        type: "string",
        // format: "secret-ref" marks this as the (only) secret-bearing field.
        // Beyond its semantic meaning, it's load-bearing: the host's config
        // secret-ref extractor falls back to flagging ANY UUID-looking string as a
        // secret reference when NO field declares format:"secret-ref". Our
        // bridges[].paperclipProjectId values ARE UUIDs, so without this the whole
        // config is rejected ("secret references are disabled"). Declaring one
        // secret-ref field scopes the extractor to this path only.
        format: "secret-ref",
        title: "GitHub Token (fallback)",
        description:
          "Optional static PAT used only when no token broker is configured. Normally unset — auth uses the GitHub App via the broker, which works across orgs and needs no stored secret.",
      },
    },
    required: ["bridges"],
  },
  // Event-driven only — no scheduled jobs.
  entrypoints: {
    worker: "./dist/worker.js",
  },
};

export default manifest;
