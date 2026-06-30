# Runbook — bidirectional GitHub ↔ Paperclip issue sync (Step 9)

Mirrors issues between **one GitHub repo** and **one Paperclip project**, in both
directions, with loop prevention.

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

### 2. Provision a write-scoped GitHub token
The existing `github_token` (used by `github-plugin`) is **read-only**. Create a
fine-grained PAT with **Issues: read & write** on the synced repo and store it in
1Password (`AgenticOS Infra / github_write_token`).

### 3. Configure the plugin (Mac, tunnel up, board key)
Pick the **synced project id** (the Paperclip project that bridges to the repo).
```bash
BK=$TF_VAR_paperclip_board_key ; BASE=http://localhost:3100
gs_id=$(curl -sS "$BASE/api/plugins" -H "Authorization: Bearer $BK" \
  | jq -r '(.plugins // .)[] | select(.pluginKey=="agenticos.github-sync-plugin") | .id')
# WRITE token from 1Password — piped, never echoed:
WT=$(op read "op://Goldberry Grove - Admin/AgenticOS Infra/github_write_token")
cfg=$(jq -nc --arg t "$WT" --arg repo "AgenticOS" --arg proj "<SYNCED_PROJECT_ID>" \
  '{configJson:{githubToken:$t, githubOrg:"EngineeringMoonBear", githubRepo:$repo, paperclipProjectId:$proj}}')
curl -sS -X POST "$BASE/api/plugins/$gs_id/config" -H "Authorization: Bearer $BK" \
  -H "Content-Type: application/json" -d "$cfg" >/dev/null && echo "configured"
```

### 4. Create the inbound routine + webhook trigger
In the synced project (`projectId` = the same `<SYNCED_PROJECT_ID>`). Note: **no
`assigneeAgentId`** — this mirrors the issue, it does not dispatch an agent.
```
POST /api/companies/{companyId}/routines
  { "title": "GitHub issue {{repo}}#{{number}}",
    "description": "<!-- synced-from-github: {{repo}}#{{number}} -->\n\n{{title}}\n\n{{body}}\n\n---\nSynced from GitHub: {{url}}",
    "status": "active", "priority": "medium",
    "projectId": "<SYNCED_PROJECT_ID>",
    "concurrencyPolicy": "coalesce_if_active", "catchUpPolicy": "skip_missed" }

POST /api/routines/{routineId}/triggers  { "kind":"webhook", "signingMode":"github_hmac" }
  → returns publicId + secret
```
(Same API mechanics as `docs/runbooks/qa-smoke-paperclip-webhook.md` — webhook
triggers are API-only; the board UI shows "coming soon".)

### 5. Repo secrets (in the synced GitHub repo)
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
- **Scope is one project ↔ one repo.** For more bridges, run another plugin instance / routine + copy the workflow into the other repo.
- **Write token least privilege:** Issues read+write on the one repo only.
- **QA double-trigger is avoided by scoping:** QA-triage issues live in a different project, so the plugin (filtered to the synced project) never mirrors them.
