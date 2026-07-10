# Phase 3.1 — Per-stage 1Password machine-secret home + read-only CI service accounts

- **Date:** 2026-07-10
- **Status:** Approved (design)
- **Owner:** Josh (operator)
- **ADR:** [ADR-0001](../../adr/0001-credential-brokering-and-secret-store.md) — first sub-project of "Phase 3 — retire Infisical."
- **Source of truth (living):** the Obsidian vault note **`Grove Secrets Inventory`** — the canonical map of *what secrets exist, which stage vault holds each, and how CI reads them*. This spec is the point-in-time design; the inventory evolves in the vault.

## Goal

Stand up the 1Password home for odoocker + grove-sites CI machine secrets so their CI can read secrets directly from 1Password (retiring the Infisical distribution layer), with QA/Prod isolation enforced by 1Password.

## Settled decisions (from brainstorming 2026-07-10)

1. **CI reads secrets via 1Password's native GitHub Action** (`1password/load-secrets-action@v2`), NOT through the credential broker. The broker is internal-only (no host port) and serves droplet/agent/high-frequency consumers; CI is external + low-frequency, so a public broker ingress would add attack surface to solve a problem CI doesn't have. **This diverges from ADR-0001's literal "CI → broker via OIDC" wording** — recorded here and to be noted in the ADR.
2. **Per-stage vaults** (`Grove Prod`, `Grove QA`) with a read-only service account scoped to each — QA physically cannot read Prod. Consistent with the ADR-0001 2026-07-10 amendment.

## Architecture

- **Vaults:** `Grove Prod`, `Grove QA`.
- **Item-per-repo** in each vault: items `grove-sites` and `odoocker`. Each secret is a **field labeled with the exact GitHub-Actions env-var name**, so refs are deterministic: `op://<vault>/<repo>/<ENV_VAR>`.
- **Service accounts (read-only):** `grove-ci-prod-ro` → `Grove Prod`, `grove-ci-qa-ro` → `Grove QA`.
- **SA tokens → GitHub Environment secrets:** the `production` environment holds the prod SA token, the `qa` environment holds the QA SA token (both as `OP_CI_SA_TOKEN`). Prod is gated by the environment's required reviewers; a `qa`-environment job can only present the QA identity.
- Since 1Password is already the upstream source (Infisical was seeded from it), placing secrets is reorganize/copy into the stage vaults, not a fresh migration. Stage-distinct secrets (e.g. a QA vs prod DO token) hold their own value per vault; a same-value secret used by both stages is duplicated into both (noted; prefer distinct values over time).

The full secret→stage→ref inventory lives in the `Grove Secrets Inventory` vault note (seeded from the deprecated Grove Secrets Pipeline lists).

## CI consumption template (the contract P3.2/P3.3 adopt)

```yaml
permissions:
  contents: read
jobs:
  deploy:
    environment: production        # or: qa
    steps:
      - uses: 1password/load-secrets-action@v2
        with:
          export-env: true
        env:
          OP_SERVICE_ACCOUNT_TOKEN: ${{ secrets.OP_CI_SA_TOKEN }}
          DIGITALOCEAN_TOKEN: op://Grove Prod/odoocker/DIGITALOCEAN_TOKEN
          # …one line per secret, refs from the inventory
```

## Operator runbook (Josh's 1Password-admin steps)

`op` cannot run from the agent's shell (1Password-agent hangs non-interactively), so these run in Josh's terminal:

1. **Create vaults:** `op vault create "Grove Prod"` and `op vault create "Grove QA"`.
2. **Place secrets** into `grove-sites` / `odoocker` items per the inventory, field label = env-var name. For secrets already in `Goldberry Grove - Admin`, read + re-create in the stage vault (e.g. `op read "op://Goldberry Grove - Admin/Grove Infra/do_token_scoped"` → set as the `DIGITALOCEAN_TOKEN` field).
3. **Create the read-only SAs** (1Password Developer → Service Accounts): `grove-ci-prod-ro` scoped read-only to `Grove Prod`; `grove-ci-qa-ro` scoped read-only to `Grove QA`. Save each `ops_…` token.
4. **Store SA tokens in GitHub Environments:** repo → Settings → Environments → `production` → secret `OP_CI_SA_TOKEN` = prod SA token; `qa` → `OP_CI_SA_TOKEN` = QA SA token. (Per repo that will consume them: odoocker, grove-sites.)

## Verification (P3.1 "done")

Isolation + access proof:

```bash
# access: prod SA reads a prod secret
OP_SERVICE_ACCOUNT_TOKEN=<grove-ci-prod-ro> op read "op://Grove Prod/odoocker/DIGITALOCEAN_TOKEN"   # → value
# isolation: QA SA cannot read Prod
OP_SERVICE_ACCOUNT_TOKEN=<grove-ci-qa-ro>   op read "op://Grove Prod/odoocker/DIGITALOCEAN_TOKEN"   # → 403 / not found
```

Green access + denied cross-stage read = foundation complete.

## In scope / out of scope

**In:** the two vaults, the two read-only SAs, the secret placement by stage, the SA tokens in GitHub Environments, the inventory (in the vault) and the CI-action template. Updating the ADR with the CI-mechanism divergence.

**Out (later sub-projects):** P3.2 odoocker workflow changes; P3.3 grove-sites onboarding; P3.4 Infisical decommission. Also deferred: minting genuinely-distinct QA-vs-prod cloud credential *values* (P3.1 places current values into the stage that uses them); wiring CI through the broker (explicitly rejected for CI).

## Consequences

- One rotatable, read-only, single-vault SA token per stage in GitHub Environments — far less than today's Infisical identity + static-GitHub-Secrets sprawl, and QA↔Prod isolation is 1Password-enforced.
- The inventory must be kept current in the vault as secrets change (that's the source-of-truth contract).
- A same-value-both-stages secret duplicated across vaults is a drift risk until split into distinct values.
