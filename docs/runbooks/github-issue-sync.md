# Runbook — bidirectional GitHub ↔ Paperclip issue sync (Step 9)

Mirrors issues between GitHub repos and Paperclip projects, in both directions,
with loop prevention. One plugin instance carries **multiple bridges** (repo ↔
project pairs), which may span orgs — auth is via the gh-token-broker (GitHub App),
not a PAT.

```
Paperclip issue created/updated (in the synced project)
  └─ github-sync-plugin (events.subscribe) → create/update GitHub issue
       (labeled `synced-from-paperclip`, body marker `<!-- synced-from-paperclip: <id> -->`)

New GitHub issue opened
  └─ .github/workflows/issue-sync-to-paperclip.yml → HMAC webhook (via Cloudflare Access)
       → Paperclip routine → creates a Paperclip issue in the synced project
          (description marker `<!-- synced-from-github: <repo>#<n> -->`)
```

## The two legs

| Leg | Mechanism | Where |
|---|---|---|
| **Paperclip → GitHub** | `github-sync-plugin` subscribes to `issue.created`/`issue.updated` (scoped to one project) and writes the GitHub issue | `packages/github-sync-plugin` |
| **GitHub → Paperclip** | a GitHub Actions workflow fires a Paperclip **routine webhook** (same CF-Access pattern as the QA webhook) which creates the mirrored Paperclip issue | `.github/workflows/issue-sync-to-paperclip.yml` + a routine |

## Loop prevention (the contract — all three pieces must agree)

- The **plugin** stamps GitHub issues it creates with the label `synced-from-paperclip` and a body marker `<!-- synced-from-paperclip: <paperclip-id> -->`.
- The **inbound routine** stamps Paperclip issues it creates with a description marker `<!-- synced-from-github: <repo>#<number> -->`.
- The plugin's `issue.created` handler **skips outbound** when it sees the `synced-from-github` marker (records the mapping instead).
- The workflow's `if:` **skips inbound** for GitHub issues carrying the `synced-from-paperclip` label.
- A `github_sync_mapping` table in the plugin DB (`paperclip_issue_id ↔ repo#number`, with `origin`) is the durable source of truth — an already-mapped issue is never re-created.

**The plugin's `paperclipProjectId` MUST equal the inbound routine's `projectId`** — that one project is the bridge. The plugin refuses to run if `paperclipProjectId` is unset (it will not mirror company-wide), so unrelated work — e.g. QA-triage issues in other projects — is never synced.

## Setup

### 1. Deploy the plugin (automatic)
Merging this lands `packages/github-sync-plugin` + its compose mount; the
`deploy-droplet-plugins` workflow builds + hot-reloads it on the Droplet. It
starts **INACTIVE** (no `paperclipProjectId`) until configured below.

### 2. GitHub auth — via the gh-token-broker (no PAT)
The plugin does **not** use a stored token. It mints **repo-scoped GitHub App
installation tokens** from the `gh-token-broker` sidecar (the "AgenticOS Developer"
App) — the same path agents use to push/PR. Because the App is installed on **both
orgs**, one plugin can write to repos in `EngineeringMoonBear` *and*
`Goldberry-Playground` with no cross-org PAT.

Prerequisite: confirm the "AgenticOS Developer" GitHub App is **installed on both
orgs** with the synced repos selected and **Issues: read & write** granted. The
plugin reads the broker from `GH_TOKEN_BROKER_URL` (already in paperclip-server's
env); to avoid depending on env passthrough to plugin workers, set
`tokenBrokerUrl: "http://gh-token-broker:9099"` in the config below. (A static
`githubToken` is supported only as a fallback when no broker is reachable.)

### 3. Configure the plugin (Mac, tunnel up, board key)
**One** plugin instance carries **all** bridges — `pluginKey` is unique, so it
can't be installed twice. Each bridge = one repo ↔ one project. Pick the project
id for each repo (the Paperclip project that bridges to it).
```bash
BK=$(op read "op://Goldberry Grove - Admin/AgenticOS Infra/paperclip_board_key")
BASE=http://localhost:3100
gs_id=$(curl -sS "$BASE/api/plugins" -H "Authorization: Bearer $BK" \
  | jq -r '(.plugins // .)[] | select(.pluginKey=="agenticos.github-sync-plugin") | .id')
cfg=$(jq -nc \
  --arg p1 "<AGENTICOS_PROJECT_ID>" --arg p2 "<GOLDBERRY_PROJECT_ID>" \
  '{configJson:{
     tokenBrokerUrl:"http://gh-token-broker:9099",
     bridges:[
       {githubOrg:"EngineeringMoonBear",  githubRepo:"AgenticOS",                paperclipProjectId:$p1},
       {githubOrg:"Goldberry-Playground", githubRepo:"odoocker-goldberrygrove", paperclipProjectId:$p2}
     ]
   }}')
curl -sS -X POST "$BASE/api/plugins/$gs_id/config" -H "Authorization: Bearer $BK" \
  -H "Content-Type: application/json" -d "$cfg" >/dev/null && echo "configured"
```
No secret touches the shell — the broker URL is non-sensitive. (Confirm the
Goldberry repo name; `odoocker-goldberrygrove` is the example.)

### 4. Create one inbound routine + webhook trigger PER bridge
Repeat for **each** project (`<AGENTICOS_PROJECT_ID>` and `<GOLDBERRY_PROJECT_ID>`)
— each project needs its own routine + webhook so its repo's workflow has a target.
Note: **no `assigneeAgentId`** — this mirrors the issue, it does not dispatch an agent.
```
POST /api/companies/{companyId}/routines
  { "title": "GitHub issue {{repo}}#{{number}}",
    "description": "<!-- synced-from-github: {{repo}}#{{number}} -->\n\n{{title}}\n\n{{body}}\n\n---\nSynced from GitHub: {{url}}",
    "status": "active", "priority": "medium",
    "projectId": "<THIS_BRIDGE_PROJECT_ID>",
    "concurrencyPolicy": "coalesce_if_active", "catchUpPolicy": "skip_missed" }

POST /api/routines/{routineId}/triggers  { "kind":"webhook", "signingMode":"github_hmac" }
  → returns publicId + secret
```
(Same API mechanics as `docs/runbooks/qa-smoke-paperclip-webhook.md` — webhook
triggers are API-only; the board UI shows "coming soon".)

### 5. Repo secrets + workflow (in EACH synced GitHub repo)
The inbound workflow `.github/workflows/issue-sync-to-paperclip.yml` lives in
AgenticOS already; **copy it into the Goldberry repo** too (it's generic — it just
fires the webhook). Then set these secrets in **each** repo, pointing at **that
repo's** routine trigger:

| Secret | Value |
| --- | --- |
| `PAPERCLIP_ISSUE_SYNC_WEBHOOK` | `https://paperclip.gatheringatthegrove.com/api/routine-triggers/public/<publicId>/fire` |
| `PAPERCLIP_ISSUE_SYNC_SECRET` | the trigger's HMAC `secret` |
| `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | **reuse the existing QA service token** — the path-scoped Access app already covers `/api/routine-triggers/public`, so the same client id/secret work |

The workflow (`issue-sync-to-paperclip.yml`) is already in the repo and no-ops
until these secrets exist.

## Verify
- **GitHub → Paperclip:** open a GitHub issue in the synced repo → within ~a minute a Paperclip issue appears in the synced project (description starts with the `synced-from-github` marker). It does **not** bounce back as a second GitHub issue.
- **Paperclip → GitHub:** create a native Paperclip issue in the synced project → a GitHub issue appears (label `synced-from-paperclip`). Closing the Paperclip issue (`done`/`cancelled`) closes the GitHub issue.
- **No loop:** the plugin-created GitHub issue (labeled `synced-from-paperclip`) does not trigger the inbound workflow; the routine-created Paperclip issue (with the marker) does not trigger an outbound GitHub issue.

## Gotchas
- **One instance, many bridges.** `pluginKey` is unique, so the plugin can't be installed twice — add bridges to the `bridges[]` config array instead. Each bridge still needs its **own** inbound routine + webhook, and the workflow copied into its repo.
- **Cross-org auth = the GitHub App, not a PAT.** A fine-grained PAT is single-owner; the gh-token-broker mints repo-scoped App installation tokens for any org the App is installed on. Confirm the App is installed on **both** orgs with the synced repos selected.
- **QA double-trigger is avoided by scoping:** QA-triage issues live in a different project, so the plugin (filtered to each bridge's project) never mirrors them.
