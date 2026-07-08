import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "agenticos.github-sync-plugin",
  apiVersion: 1,
  version: "0.5.1",
  displayName: "GitHub Sync",
  description:
    "Bidirectional issue sync between Paperclip and GitHub. Paperclip → GitHub mirrors issue changes via the gh-token-broker (GitHub App, no PAT); GitHub → Paperclip creates mirror issues from an inbound HMAC webhook (agent-free). Multiple repo↔project bridges across orgs.",
  author: "AgenticOS",
  categories: ["connector"],
  // events.subscribe: the worker subscribes to core "issue.created" / "issue.updated".
  // http.outbound: the github-client writes issues to the GitHub REST API.
  // database.namespace.{read,write,migrate}: a "github_sync_mapping" table in the
  //   plugin DB namespace links paperclip_issue_id <-> github repo#number and records
  //   sync origin for loop prevention. The table is created by migrations/001_init.sql
  //   (runtime DDL via ctx.db.execute is forbidden), and runtime reads/writes are
  //   namespace-qualified via ctx.db.namespace (gated behind these capabilities).
  // issues.read: REQUIRED and added beyond the original spec list. The plugin event
  //   payload for issue.created/issue.updated is delta-based (the activity-log
  //   `details` blob — title/identifier/changed-fields), NOT the full Issue object,
  //   and notably does NOT carry the description on create. To build the GitHub
  //   issue body (title + description + status) the handler reads the full issue
  //   back via ctx.issues.get(event.entityId, event.companyId), which the host
  //   gates behind issues.read. See vendor/paperclip/server/src/services/activity-log.ts.
  // issues.create + webhooks.receive: the inbound leg. The host exposes a public
  //   (board-auth-free) endpoint POST /api/plugins/:id/webhooks/github-issue for the
  //   GitHub Actions workflow; onWebhook verifies the HMAC and creates the mirror
  //   issue directly via ctx.issues.create. Routines can't do this — every routine
  //   run requires an agent ("Default agent required"), so they dispatch work rather
  //   than mirror. The plugin webhook auth-route mode is disabled on this host, but
  //   manifest-declared webhooks (webhooks.receive) are the supported public path.
  capabilities: [
    "events.subscribe",
    "http.outbound",
    "issues.read",
    "issues.create",
    "webhooks.receive",
    "database.namespace.read",
    "database.namespace.write",
    "database.namespace.migrate",
  ],
  // Inbound endpoint. The workflow POSTs the GitHub issue-opened payload here;
  // signature verification is the plugin's responsibility (see onWebhook).
  webhooks: [
    {
      endpointKey: "github-issue",
      displayName: "GitHub issue opened → Paperclip mirror (custom Actions workflow)",
      description:
        "Receives a GitHub issue-opened payload {repo,number,title,body,url} (HMAC-signed with inboundWebhookSecret) and creates the mirror Paperclip issue in the matching bridge's project. Requires a per-repo Actions workflow + repo secret.",
    },
    {
      endpointKey: "github-app",
      displayName: "GitHub App issues event → Paperclip mirror (no per-repo setup)",
      description:
        "Point the AgenticOS Developer GitHub App's webhook here and subscribe it to `issues` events. GitHub then delivers a native, signed `issues` payload for EVERY installed repo — the plugin mirrors `opened` issues into a matching bridge's project. Verified with appWebhookSecret; no per-repo Actions workflow or repo secret needed.",
    },
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
            defaultAssigneeAgentId: {
              type: "string",
              title: "Default assignee agent ID (inbound routing)",
              description:
                "Agent UUID that inbound mirror issues from this repo are assigned to. REQUIRED to close the auto-pickup loop: Paperclip agents never pick up unassigned work, so a mirror created without an assignee sits unowned forever. Set this to the owner for the bridge (e.g. the Founding Engineer for AgenticOS infra issues) and new GitHub issues enter that agent's heartbeat automatically.",
            },
            defaultPriority: {
              type: "string",
              title: "Default mirror priority",
              description: "Priority for mirror issues created from this repo. Defaults to \"medium\" if unset or invalid.",
              enum: ["critical", "high", "medium", "low"],
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
      companyId: {
        type: "string",
        title: "Company ID (inbound)",
        description:
          "UUID of the company owning the synced projects. Required for the inbound leg — the public webhook has no actor, so ctx.issues.create needs the company explicitly.",
      },
      inboundWebhookSecret: {
        type: "string",
        // Deliberately NOT format:"secret-ref": this host strips secret-ref
        // fields from saved config (ref resolution is disabled until
        // company-scoped plugin config lands), so marking it meant the worker
        // saw NO secret and rejected every inbound delivery (verified live
        // 2026-07-08). The raw hex value is not UUID-shaped, so it passes the
        // extractor as long as one field (githubToken) stays secret-ref.
        title: "Inbound webhook HMAC secret (custom workflow path)",
        description:
          "Shared secret the GitHub Actions workflow signs the inbound payload with (X-Hub-Signature-256). onWebhook verifies it before creating a mirror issue. Set the SAME value as the workflow's PAPERCLIP_ISSUE_SYNC_SECRET repo secret. Only needed for the `github-issue` endpoint; the `github-app` endpoint uses appWebhookSecret instead.",
      },
      appWebhookSecret: {
        type: "string",
        // NOT format:"secret-ref" — same reason as inboundWebhookSecret above.
        title: "GitHub App webhook secret (native issues path)",
        description:
          "The webhook secret configured on the AgenticOS Developer GitHub App. Verifies X-Hub-Signature-256 on native `issues` events delivered to the `github-app` endpoint. Set this to the SAME value as the App's webhook secret. Preferred over per-repo inboundWebhookSecret — one secret covers every installed repo.",
      },
      opsWebhookUrl: {
        type: "string",
        title: "Ops webhook URL (Discord)",
        description:
          "Optional Discord (or Discord-compatible) webhook URL. When set, the plugin posts a best-effort `{content}` ping on every inbound mirror creation so triage is never silent — including a loud warning when the mirror landed unassigned. A failed ping never blocks mirror creation.",
      },
    },
    required: ["bridges"],
  },
  // Event-driven + inbound webhook. No scheduled jobs.
  entrypoints: {
    worker: "./dist/worker.js",
  },
};

export default manifest;
