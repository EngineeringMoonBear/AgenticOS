# Runbook — odoocker QA smoke failure → Paperclip Dev Agent

Wires a QA smoke-test failure in **odoocker** to the **Dev Agent** in Paperclip:
the workflow fires a Paperclip *routine webhook*; the routine creates work
assigned to the Dev Agent, which investigates and opens a **draft PR**. A regular
GitHub issue is opened in parallel for human audit.

```
stack-smoke-test fails on push to main (odoocker .github/workflows/ci.yml)
  ├─ POST → Paperclip routine webhook (HMAC-signed, through Cloudflare Access)
  │     └─ routine → work item assigned to Dev Agent → draft PR back to the repo
  └─ gh issue create (label qa-broken)   # human audit trail only
```

**The real smoke test** is the `stack-smoke-test` job in
`Goldberry-Playground/odoocker-goldberrygrove` `.github/workflows/ci.yml`: it
boots Postgres + Odoo via docker-compose and fails if Odoo never serves
`/web/login` within 10 min. `ci.yml` runs on **push and PR to `main`**, but the
agent should fire **only on push-to-main failures** — a regression that already
merged and broke the deployable backend. Firing on every PR iteration would be
noise (the author is already on it). There is **no** `FAILED_URLS` list or
`release-manifest.yaml`; the payload below carries the commit + run URL instead.

## The Cloudflare Access wrinkle (why this runbook exists)

`paperclip.gatheringatthegrove.com` is behind Cloudflare Access (Google SSO). A
GitHub Actions runner POSTing to the webhook would be `302`'d to the Google login
and the call would fail. The fix is a **Cloudflare Access service token**, scoped
(via Terraform) to **only** the webhook path
`…/api/routine-triggers/public/<publicId>/fire`. The workflow sends the token as
two headers and is let through; humans elsewhere on the host still hit SSO.

## Setup

### 1. Apply the Terraform (AgenticOS — once)

`infra/terraform/cloudflare-qa-webhook.tf` creates the service token + the
path-scoped Access app + policy. After `terraform apply`, capture the creds
(client secret is shown once):

```bash
cd infra/terraform
terraform apply
terraform output -raw qa_smoke_access_client_id        # not secret
terraform output -raw qa_smoke_access_client_secret    # store in 1Password
```

### 2. Create the Paperclip routine + webhook trigger (operator, via board UI or API)

The Paperclip API is itself behind Access, so do this from your authenticated
session (board UI) or with your own Access creds.

```
POST /api/companies/{goldberry-grove-company-id}/routines
  { "title": "QA smoke failure on main — {{commit}}",
    "description": "{{summary}}\nCommit: {{commit}}\nRun: {{run_url}}\nInvestigate why the Odoo backend stack fails to come online, then open a draft PR.",
    "assigneeAgentId": "<dev-agent-id>", "priority": "high", "status": "active",
    "concurrencyPolicy": "coalesce_if_active", "catchUpPolicy": "skip_missed" }

POST /api/routines/{routine-id}/triggers
  { "kind": "webhook", "signingMode": "github_hmac" }
  → returns { webhookUrl: ".../api/routine-triggers/public/<publicId>/fire", secret: "..." }
```

The `{{...}}` fields interpolate from the webhook JSON payload (verified: Paperclip
fills `triggerPayload` keys into the routine). **Note:** the returned `webhookUrl`
is built from `PAPERCLIP_API_URL` (internal); for the workflow use the **public**
host + the same path:
`https://paperclip.gatheringatthegrove.com/api/routine-triggers/public/<publicId>/fire`.

### 3. Store odoocker GitHub Actions secrets

| Secret | Value |
| --- | --- |
| `PAPERCLIP_QA_TRIAGE_WEBHOOK` | `https://paperclip.gatheringatthegrove.com/api/routine-triggers/public/<publicId>/fire` |
| `PAPERCLIP_QA_TRIAGE_SECRET` | the trigger's HMAC `secret` |
| `CF_ACCESS_CLIENT_ID` | `qa_smoke_access_client_id` output |
| `CF_ACCESS_CLIENT_SECRET` | `qa_smoke_access_client_secret` output |

### 4. The odoocker workflow step (in odoocker-goldberrygrove, not here)

Add this as the **last step of the `stack-smoke-test` job** in
`.github/workflows/ci.yml`, right **before** the `Tear down` step. The job also
needs `permissions: { contents: read, issues: write }` (the workflow default is
`contents: read` only, so `gh issue create` would 403 without the bump), and the
`qa-broken` label must exist in the repo.

```yaml
- name: On smoke failure (main only), fire Paperclip Dev Agent + open GH issue
  if: failure() && github.event_name == 'push' && github.ref == 'refs/heads/main'
  env:
    WEBHOOK_URL: ${{ secrets.PAPERCLIP_QA_TRIAGE_WEBHOOK }}
    HMAC_SECRET: ${{ secrets.PAPERCLIP_QA_TRIAGE_SECRET }}
    CF_ID: ${{ secrets.CF_ACCESS_CLIENT_ID }}
    CF_SECRET: ${{ secrets.CF_ACCESS_CLIENT_SECRET }}
    GH_TOKEN: ${{ github.token }}
    RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
  run: |
    # No-op until the Paperclip webhook is configured (secrets unset) — keeps a
    # pre-activation main regression from failing the job on a missing secret.
    if [ -z "$WEBHOOK_URL" ] || [ -z "$HMAC_SECRET" ]; then
      echo "Paperclip QA webhook not configured (secrets unset) — skipping agent trigger."
    else
      PAYLOAD=$(jq -nc \
        --arg repo "$GITHUB_REPOSITORY" \
        --arg commit "$GITHUB_SHA" \
        --arg run_url "$RUN_URL" \
        --arg summary "Backend stack smoke test failed on main — Odoo did not come online." \
        '{kind:"qa_smoke_failure", repo:$repo, commit:$commit, run_url:$run_url, summary:$summary}')
      # HMAC over the EXACT bytes sent (jq -c keeps it compact + stable).
      SIG=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$HMAC_SECRET" -hex | sed 's/^.*= //')
      curl -fsS -X POST "$WEBHOOK_URL" \
        -H "Content-Type: application/json" \
        -H "X-Hub-Signature-256: sha256=$SIG" \
        -H "CF-Access-Client-Id: $CF_ID" \
        -H "CF-Access-Client-Secret: $CF_SECRET" \
        --data "$PAYLOAD"
    fi
    gh issue create --label qa-broken \
      --title "QA smoke failed on main: run #${GITHUB_RUN_ID}" \
      --body "Backend stack smoke test failed on \`main\` (Odoo did not come online). Run: ${RUN_URL} · Dev Agent notified via Paperclip (if configured)."
```

The two **`CF-Access-*` headers** are what make the POST traverse Cloudflare
Access. `X-Hub-Signature-256` is HMAC over the **raw body** (must match the bytes
sent) so Paperclip's `github_hmac` check passes. The `[ -z "$WEBHOOK_URL" ]`
guard makes the step safe to merge **before** the secrets exist — it no-ops
until activation, so it can land independently of the Terraform/routine steps.

## Prerequisites / gotchas

- **Dev Agent must be able to push/PR**: it auths via the GitHub App + the
  token-broker. Confirm the App is installed on the org that owns the target
  repos with those repos selected, and that the Dev Agent has
  `instructionsFilePath = /paperclip/agent-house-rules.md` (which now says "open
  PRs as drafts").
- **No double-trigger**: the `qa-broken` GitHub issue is audit-only today. When
  Paperclip↔GitHub issue-sync (Migration Step 9) lands, make sure the synced
  `qa-broken` issue isn't *also* routed to Dev Agent, or you'd get two runs.
- **Signature byte-for-byte**: build the HMAC over the exact `--data` bytes; jq
  `-c` keeps the payload compact + stable.
