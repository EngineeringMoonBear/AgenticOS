# Runbook — odoocker QA smoke failure → Paperclip Dev Agent

Wires a QA smoke-test failure in **odoocker** to the **Dev Agent** in Paperclip:
the workflow fires a Paperclip *routine webhook*; the routine creates work
assigned to the Dev Agent, which investigates and opens a **draft PR**. A regular
GitHub issue is opened in parallel for human audit.

```
smoke test fails (odoocker workflow)
  ├─ POST → Paperclip routine webhook (HMAC-signed, through Cloudflare Access)
  │     └─ routine → work item assigned to Dev Agent → draft PR back to the repo
  └─ gh issue create (label qa-broken)   # human audit trail only
```

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
  { "title": "QA smoke failure — {{run_url}}",
    "description": "Investigate failing URLs {{failed_urls}} vs manifest {{manifest_sha}}.\n{{manifest}}\nRun: {{run_url}}",
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

### 4. The odoocker workflow step (in the odoocker repo, not here)

```yaml
- name: On failure, fire Paperclip routine + open GH issue
  if: failure()
  env:
    WEBHOOK_URL: ${{ secrets.PAPERCLIP_QA_TRIAGE_WEBHOOK }}
    HMAC_SECRET: ${{ secrets.PAPERCLIP_QA_TRIAGE_SECRET }}
    CF_ID: ${{ secrets.CF_ACCESS_CLIENT_ID }}
    CF_SECRET: ${{ secrets.CF_ACCESS_CLIENT_SECRET }}
    GH_TOKEN: ${{ github.token }}
  run: |
    PAYLOAD=$(jq -nc \
      --arg manifest_sha "$(sha256sum infra/release-manifest.yaml | cut -c1-12)" \
      --arg failed_urls "$FAILED_URLS" \
      --arg run_url "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" \
      --arg manifest "$(cat infra/release-manifest.yaml)" \
      '{kind:"qa_smoke_failure", manifest_sha:$manifest_sha, failed_urls:$failed_urls, run_url:$run_url, manifest:$manifest}')

    SIG=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$HMAC_SECRET" -hex | sed 's/^.*= //')

    curl -fsS -X POST "$WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -H "X-Hub-Signature-256: sha256=$SIG" \
      -H "CF-Access-Client-Id: $CF_ID" \
      -H "CF-Access-Client-Secret: $CF_SECRET" \
      --data "$PAYLOAD"

    gh issue create --label qa-broken \
      --title "QA smoke failed: run #$GITHUB_RUN_ID" \
      --body "Smoke failed. Failing URLs: $FAILED_URLS · Run: $GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID · Dev Agent notified via Paperclip."
```

The two **`CF-Access-*` headers** are what make the POST traverse Cloudflare
Access. `X-Hub-Signature-256` is HMAC over the **raw body** (must match the bytes
sent) so Paperclip's `github_hmac` check passes.

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
