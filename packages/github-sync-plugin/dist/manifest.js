// src/manifest.ts
var manifest = {
  id: "agenticos.github-sync-plugin",
  apiVersion: 1,
  // Bump on ANY manifest change — a stale stored manifest silently masks changes
  // (spec gotcha; see #228). 0.6.0 = discipline label routing (GOL-150).
  // 0.7.0 = agent PR review pipeline (GOL-158, Phase 2): `github-pr` webhook.
  // 0.7.1 = plugin-side agent-review sign-off completion (GOL-186): an
  //   issue.updated dispatch completes the `agent-review/*` check-run to success
  //   when the review issue closes `done` (Phase 3 prerequisite). No new
  //   capabilities/webhooks — reuses issues.read + http.outbound (checks:write is
  //   an App-side grant, GOL-175), so the manifest surface is unchanged bar version.
  // 0.8.0 = swallowed-failure observability (GOL-296): caught exceptions in
  //   onWebhook / event dispatch now write a queryable `github_sync_error` row
  //   (migrations/003) AND fire a 🚨 ops-webhook alert, instead of vanishing into
  //   host server.log. No new capabilities — reuses database.namespace.write +
  //   http.outbound; a new migration ships under the existing `database` block.
  // 0.9.0 = CI → Paperclip fix-issue loop (GOL-305, from the GOL-303 audit). The App's
  //   native `check_suite`/`workflow_run` **completed** events land on the same
  //   `github-app` webhook URL and are fanned out by X-GitHub-Event: a failing CI
  //   check on an agent-authored PR opens/updates an author-assigned fix issue, and a
  //   green suite auto-closes it (loop-guarded per (repo, PR#) via github_ci_failure,
  //   migrations/004). No new capabilities/webhook endpoints — reuses issues.create/
  //   update + issue.comments.create + http.outbound; needs the App subscribed to
  //   `check_suite`/`workflow_run` and granted `checks:read` (GOL-304 / T1).
  // 0.9.1 = inbound invocation-scope fix (GOL-300/GOL-295): the mirror-create and
  //   closure paths now re-enter the captured host scope (runInScope), matching the
  //   PR-path fix (GOL-179). Bugfix only — manifest surface unchanged bar version.
  version: "0.9.1",
  displayName: "GitHub Sync",
  description: "Bidirectional issue sync between Paperclip and GitHub. Paperclip \u2192 GitHub mirrors issue changes via the gh-token-broker (GitHub App, no PAT); GitHub \u2192 Paperclip creates mirror issues from an inbound HMAC webhook (agent-free). Multiple repo\u2194project bridges across orgs.",
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
  // issues.update + issue.comments.create: the PR review pipeline (GOL-158) reopens
  //   (`todo`) an existing review issue on `synchronize` and posts a "new commits"
  //   note comment. Both are gated behind these capabilities.
  capabilities: [
    "events.subscribe",
    "http.outbound",
    "issues.read",
    "issues.create",
    "issues.update",
    "issue.comments.create",
    "webhooks.receive",
    "database.namespace.read",
    "database.namespace.write",
    "database.namespace.migrate"
  ],
  // Inbound endpoint. The workflow POSTs the GitHub issue-opened payload here;
  // signature verification is the plugin's responsibility (see onWebhook).
  webhooks: [
    {
      endpointKey: "github-issue",
      displayName: "GitHub issue opened \u2192 Paperclip mirror (custom Actions workflow)",
      description: "Receives a GitHub issue-opened payload {repo,number,title,body,url} (HMAC-signed with inboundWebhookSecret) and creates the mirror Paperclip issue in the matching bridge's project. Requires a per-repo Actions workflow + repo secret."
    },
    {
      endpointKey: "github-app",
      displayName: "GitHub App issues / pull_request / check_suite / workflow_run \u2192 Paperclip (no per-repo setup)",
      description: "Point the AgenticOS Developer GitHub App's single webhook here. Subscribe it to `issues` (mirror opened issues + closure propagation), `pull_request` (agent review pipeline, GOL-158), and \u2014 for the CI\u2192Paperclip fix loop (GOL-305) \u2014 `check_suite`/`workflow_run`. All arrive on this one URL and are fanned out by X-GitHub-Event. On a failing CI check on an agent-authored PR the plugin opens/updates a fix issue assigned to the code owner, and auto-closes it when the suite goes green. Verified with appWebhookSecret; the CI loop needs the App granted `checks:read` (+ the two event subscriptions, GOL-304). No per-repo Actions workflow or repo secret needed."
    },
    {
      endpointKey: "github-pr",
      displayName: "GitHub App pull_request event \u2192 agent review pipeline (GOL-158)",
      description: "Subscribe the AgenticOS Developer GitHub App to `pull_request` events and point them here. For each non-draft PR (opened/reopened/ready_for_review/synchronize) the plugin creates review issue(s) in the matching bridge's project \u2014 Alice always, Iris when a changed path matches `prReviewFrontendPaths` \u2014 and seeds a pending `agent-review/*` check-run on the head SHA. Verified with appWebhookSecret (same as `github-app`). Needs the App's `checks:write` permission for check-runs."
    }
  ],
  // Declaring `database` is REQUIRED for the host to provision + activate the
  // plugin's Postgres namespace (without it, ensureNamespace returns null and the
  // worker fails with "namespace is not active"). migrationsDir → migrations/001_init.sql
  // creates the github_sync_mapping table (runtime DDL via ctx.db.execute is
  // forbidden by the host contract, so the table MUST come from a migration).
  database: {
    namespaceSlug: "github_sync",
    migrationsDir: "migrations"
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      bridges: {
        type: "array",
        title: "Repo \u2194 Project bridges",
        description: "Each entry mirrors one GitHub repo to one Paperclip project. ONLY issues in a bridge's project are mirrored to its repo \u2014 the worker refuses to subscribe company-wide, so unrelated work (e.g. QA-triage issues in other projects) is never mirrored. Add one entry per repo you want synced; they may span multiple orgs (the gh-token-broker mints a token per repo).",
        items: {
          type: "object",
          properties: {
            githubOrg: {
              type: "string",
              title: "GitHub Org/Owner",
              description: "Owner of the target repository.",
              default: "EngineeringMoonBear"
            },
            githubRepo: {
              type: "string",
              title: "GitHub Repo (no owner)",
              description: "Target repository name. Native Paperclip issues are mirrored here."
            },
            paperclipProjectId: {
              type: "string",
              title: "Paperclip Project ID",
              description: "The project that bridges to githubRepo. Must equal the inbound routine's projectId."
            },
            syncLabelPaperclip: {
              type: "string",
              title: "Paperclip \u2192 GitHub label",
              description: "Label applied to GitHub issues created from Paperclip issues.",
              default: "synced-from-paperclip"
            },
            syncMarkerGithub: {
              type: "string",
              title: "GitHub \u2192 Paperclip marker label",
              description: "Label marking issues that originated in GitHub (set by the inbound routine).",
              default: "synced-from-github"
            },
            defaultAssigneeAgentId: {
              type: "string",
              title: "Default assignee agent ID (inbound routing)",
              description: "Agent UUID that inbound mirror issues from this repo are assigned to. Backward-compatible last resort: used only when no labelRouting label matches AND no fallbackAssigneeAgentId is set. Paperclip agents never pick up unassigned work, so leaving all three empty means mirrors sit unowned forever."
            },
            labelRouting: {
              type: "object",
              title: "Discipline label routing (v0.6.0)",
              description: 'Map of GitHub label name \u2192 assignee agent UUID. An inbound issue is assigned to the owner of its highest-precedence matching label. Fixed precedence: infra = bug = alert > frontend > feature (first match by precedence wins). Example: {"frontend":"<Iris>","feature":"<Alice>","bug":"<Terra>","infra":"<Terra>","alert":"<Terra>"}. No match \u2192 fallbackAssigneeAgentId \u2192 defaultAssigneeAgentId.',
              additionalProperties: { type: "string" }
            },
            fallbackAssigneeAgentId: {
              type: "string",
              title: "Fallback assignee agent ID (unlabeled triage)",
              description: "Agent UUID assigned when no labelRouting label matches \u2014 the triage owner (e.g. the CEO). Takes precedence over defaultAssigneeAgentId for the no-label case so unlabeled GitHub issues still enter a heartbeat instead of piling up unowned."
            },
            defaultPriority: {
              type: "string",
              title: "Default mirror priority",
              description: 'Priority for mirror issues created from this repo. Defaults to "medium" if unset or invalid.',
              enum: ["critical", "high", "medium", "low"]
            }
          },
          required: ["githubOrg", "githubRepo", "paperclipProjectId"]
        }
      },
      tokenBrokerUrl: {
        type: "string",
        title: "Token Broker URL",
        description: "gh-token-broker endpoint that mints repo-scoped GitHub App installation tokens. Defaults to the GH_TOKEN_BROKER_URL env var; set to http://gh-token-broker:9099 if the env is not passed to plugin workers."
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
        description: "Optional static PAT used only when no token broker is configured. Normally unset \u2014 auth uses the GitHub App via the broker, which works across orgs and needs no stored secret."
      },
      companyId: {
        type: "string",
        title: "Company ID (inbound)",
        description: "UUID of the company owning the synced projects. Required for the inbound leg \u2014 the public webhook has no actor, so ctx.issues.create needs the company explicitly."
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
        description: "Shared secret the GitHub Actions workflow signs the inbound payload with (X-Hub-Signature-256). onWebhook verifies it before creating a mirror issue. Set the SAME value as the workflow's PAPERCLIP_ISSUE_SYNC_SECRET repo secret. Only needed for the `github-issue` endpoint; the `github-app` endpoint uses appWebhookSecret instead."
      },
      appWebhookSecret: {
        type: "string",
        // NOT format:"secret-ref" — same reason as inboundWebhookSecret above.
        title: "GitHub App webhook secret (native issues path)",
        description: "The webhook secret configured on the AgenticOS Developer GitHub App. Verifies X-Hub-Signature-256 on native `issues` events delivered to the `github-app` endpoint. Set this to the SAME value as the App's webhook secret. Preferred over per-repo inboundWebhookSecret \u2014 one secret covers every installed repo."
      },
      opsWebhookUrl: {
        type: "string",
        title: "Ops webhook URL (Discord)",
        description: "Optional Discord (or Discord-compatible) webhook URL. When set, the plugin posts a best-effort `{content}` ping on every inbound mirror creation so triage is never silent \u2014 including a loud warning when the mirror landed unassigned. A failed ping never blocks mirror creation. Also carries the PR-review state-change pings (System 3): review-issues-created, re-review-on-new-commits, and pipeline errors \u2014 and \u{1F6A8} swallowed-failure alerts (GOL-296) when a caught exception in onWebhook or an event dispatch would otherwise vanish into server.log."
      },
      prReviewAliceAgentId: {
        type: "string",
        title: "PR review \u2014 Alice agent ID (GOL-158)",
        description: "Agent UUID that ALWAYS reviews every non-draft PR (spec System 2). Leave empty to disable the PR review pipeline (the `github-pr` webhook then no-ops). Company-global \u2014 the review issue is created in the matched bridge's project."
      },
      prReviewIrisAgentId: {
        type: "string",
        title: "PR review \u2014 Iris agent ID (frontend, GOL-158)",
        description: "Agent UUID that ADDITIONALLY reviews a PR when any changed path matches prReviewFrontendPaths. Leave empty to skip frontend review even when frontend paths change."
      },
      prReviewFrontendPaths: {
        type: "array",
        title: "PR review \u2014 frontend path globs (GOL-158)",
        description: 'Changed-file globs that trigger a second (Iris) frontend review. Supports `*` (within a segment) and `**` (across segments). Defaults to ["apps/dashboard/**", "**/*.tsx", "**/*.css"] when empty.',
        items: { type: "string" }
      },
      ciAgentPrAuthor: {
        type: "string",
        title: "CI-fix \u2014 agent PR author login (GOL-305)",
        description: `GitHub login that authors agent PRs. The CI\u2192Paperclip fix loop only opens a fix issue when a failing PR's author matches this. Defaults to "agenticos-developer[bot]" (the shared Developer App identity). The fix loop reuses prReviewAliceAgentId/prReviewIrisAgentId for owner routing and is off when prReviewAliceAgentId is unset.`
      }
    },
    required: ["bridges"]
  },
  // Event-driven + inbound webhook. No scheduled jobs.
  entrypoints: {
    worker: "./dist/worker.js"
  }
};
var manifest_default = manifest;
export {
  manifest_default as default
};
