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
       → plugin webhook onWebhook → ctx.issues.create in the matching bridge's project
          (description marker `<!-- synced-from-github: <repo>#<n> -->`)
```

## The two legs

| Leg | Mechanism | Where |
|---|---|---|
| **Paperclip → GitHub** | `github-sync-plugin` subscribes company-wide to `issue.created`/`issue.updated`, routes by the issue's project to the matching bridge, and writes the GitHub issue via the broker token | `packages/github-sync-plugin` (worker/sync) |
| **GitHub → Paperclip** | a GitHub Actions workflow POSTs the issue payload (HMAC-signed, via CF Access) to the plugin's public webhook `POST /api/plugins/:id/webhooks/github-issue`; `onWebhook` creates the mirror issue directly (agent-free) | `packages/github-sync-plugin` (inbound/onWebhook) + `.github/workflows/issue-sync-to-paperclip.yml` |

## Loop prevention (the contract — all pieces must agree)

- The **plugin** stamps GitHub issues it creates with the label `synced-from-paperclip` and a body marker `<!-- synced-from-paperclip: <paperclip-id> -->`.
- The plugin's **`onWebhook`** stamps the Paperclip issues it creates with a description marker `<!-- synced-from-github: <repo>#<number> -->` (and records the mapping with `origin=github` up front).
- The plugin's `issue.created` handler **skips outbound** when it sees the `synced-from-github` marker (records the mapping instead).
- The workflow's `if:` **skips inbound** for GitHub issues carrying the `synced-from-paperclip` label.
- A `github_sync_mapping` table in the plugin DB (`paperclip_issue_id ↔ repo#number`, with `origin`) is the durable source of truth — an already-mapped GitHub issue is never re-created (idempotent redelivery via `getByRepoNumber`).

Mirroring stays scoped to configured projects: the outbound handler drops issues whose project isn't a bridge, and `onWebhook` drops payloads whose `repo` isn't a bridge — so unrelated work (e.g. QA-triage issues in other projects) is never synced.

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
can't be installed twice. Set the bridges, the **company id** (needed for the
inbound leg — the public webhook has no actor), and an **inbound HMAC secret**
(shared with the workflow). Generate the secret once; it goes in BOTH the plugin
config and each repo's `PAPERCLIP_ISSUE_SYNC_SECRET`.
```bash
BK=$(op read "op://Goldberry Grove - Admin/AgenticOS Infra/paperclip_board_key")
BASE=http://localhost:3100
CID=6a74334e-9dd3-4491-8cd5-da418e970a2e
WHSEC=$(openssl rand -hex 32)   # inbound webhook secret — keep out of chat
gs_id=$(curl -sS "$BASE/api/plugins" -H "Authorization: Bearer $BK" \
  | jq -r '.[] | select(.pluginKey=="agenticos.github-sync-plugin") | .id')
cfg=$(jq -nc --arg cid "$CID" --arg sec "$WHSEC" \
  --arg p1 "<AGENTICOS_PROJECT_ID>" --arg p2 "<GOLDBERRY_PROJECT_ID>" \
  --arg fe "<FOUNDING_ENGINEER_AGENT_ID>" --arg ops "<DISCORD_OPS_WEBHOOK_URL>" \
  '{configJson:{
     companyId:$cid,
     inboundWebhookSecret:$sec,
     tokenBrokerUrl:"http://gh-token-broker:9099",
     opsWebhookUrl:$ops,
     bridges:[
       {githubOrg:"EngineeringMoonBear",  githubRepo:"AgenticOS",                paperclipProjectId:$p1, defaultAssigneeAgentId:$fe},
       {githubOrg:"Goldberry-Playground", githubRepo:"odoocker-goldberrygrove", paperclipProjectId:$p2, defaultAssigneeAgentId:$fe}
     ]
   }}')
# defaultAssigneeAgentId is REQUIRED to close the auto-pickup loop (GOL-80): a mirror
# created without an assignee is never picked up (agents don't take unassigned work).
# opsWebhookUrl is optional — a Discord webhook that gets a ping on each mirror creation.
curl -sS -X POST "$BASE/api/plugins/$gs_id/config" -H "Authorization: Bearer $BK" \
  -H "Content-Type: application/json" -d "$cfg" >/dev/null && echo "configured"
printf '%s' "$WHSEC" | pbcopy   # secret on clipboard for the repo secret; do NOT paste it into chat
# Config saves don't restart the worker → disable/enable so setup + webhook registration take effect:
curl -sS -X POST "$BASE/api/plugins/$gs_id/disable" -H "Authorization: Bearer $BK" >/dev/null
curl -sS -X POST "$BASE/api/plugins/$gs_id/enable"  -H "Authorization: Bearer $BK" | jq '{status}'
```
(Confirm the Goldberry repo name; `odoocker-goldberrygrove` is the example.)

### 4. Inbound leg = the plugin's public webhook (NO routine)
There is **no routine**. A routine run always dispatches an agent (`Default agent
required`) — it can't just create a mirror issue, and on the Odoocker bridge it
would double-trigger the QA webhook. Instead the plugin declares a public,
board-auth-free webhook endpoint that creates the mirror issue directly:

```
POST https://paperclip.gatheringatthegrove.com/api/plugins/<gs_id>/webhooks/github-issue
```

`onWebhook` verifies `X-Hub-Signature-256` against `inboundWebhookSecret`, then
`ctx.issues.create`s the issue in the bridge whose repo matches the payload's
`repo` field, stamped with the `synced-from-github` marker (so the outbound
handler records the mapping and does **not** bounce it back). **One endpoint serves
both repos** — routing is by `repo`, so there's no per-repo endpoint or per-repo
routine.

### 5. Repo secrets + workflow (in EACH synced GitHub repo)
The inbound workflow `.github/workflows/issue-sync-to-paperclip.yml` lives in
AgenticOS already; **copy it into the Goldberry repo** too (it's generic — it just
POSTs the payload). Set these secrets in **each** repo (same values in both):

| Secret | Value |
| --- | --- |
| `PAPERCLIP_ISSUE_SYNC_WEBHOOK` | `https://paperclip.gatheringatthegrove.com/api/plugins/<gs_id>/webhooks/github-issue` |
| `PAPERCLIP_ISSUE_SYNC_SECRET` | the `inboundWebhookSecret` from §3 (identical in both repos + the plugin config) |
| `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | reuse the QA service token — see the CF-Access gotcha below |

⚠️ **CF Access must be widened.** The QA service-token Access policy is path-scoped
to `/api/routine-triggers/public/*`. The plugin webhook lives under
`/api/plugins/*/webhooks/*`, so the workflow's service token will be **302'd to SSO
and fail** until the Access app/policy is extended to cover that path (update
`infra/terraform/cloudflare-qa-webhook.tf` to add the plugin-webhook path, or add a
second path-scoped policy for the same service token). Without this the inbound leg
can't be reached from GitHub Actions.

The workflow no-ops until these secrets exist.

## Verify
- **GitHub → Paperclip:** open a GitHub issue in the synced repo → within ~a minute a Paperclip issue appears in the synced project (description starts with the `synced-from-github` marker). It does **not** bounce back as a second GitHub issue.
- **Paperclip → GitHub:** create a native Paperclip issue in the synced project → a GitHub issue appears (label `synced-from-paperclip`). Closing the Paperclip issue (`done`/`cancelled`) closes the GitHub issue.
- **No loop:** the plugin-created GitHub issue (labeled `synced-from-paperclip`) does not trigger the inbound workflow; the `onWebhook`-created Paperclip issue (with the marker) does not trigger an outbound GitHub issue.

## Gotchas
- **One instance, many bridges, one inbound endpoint.** `pluginKey` is unique, so the plugin can't be installed twice — add bridges to the `bridges[]` config array. The **single** webhook endpoint `/api/plugins/:id/webhooks/github-issue` serves all repos (routing is by the payload's `repo`); each repo just needs the workflow + secrets pointing at it.
- **Cross-org auth = the GitHub App, not a PAT.** A fine-grained PAT is single-owner; the gh-token-broker mints repo-scoped App installation tokens for any org the App is installed on. Confirm the App is installed on **both** orgs with the synced repos selected.
- **QA double-trigger is avoided by scoping:** QA-triage issues live in a different project, so the plugin (filtered to each bridge's project) never mirrors them.
