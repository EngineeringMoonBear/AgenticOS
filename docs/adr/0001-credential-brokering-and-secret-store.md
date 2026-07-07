# ADR-0001: Secret store + credential brokering (retire Infisical; 1Password + caching broker)

- **Status:** Proposed
- **Date:** 2026-07-07
- **Deciders:** Josh (CEO/operator)
- **Scope:** AgenticOS, odoocker, grovesites, and future apps + their QA/Prod deploy pipelines

## Context and drivers

1. **Cost.** We are paying for Infisical Cloud (used today for odoocker/grovesites machine secrets) and want to stop.
2. **Programmatic DevOps for agents.** Paperclip agents need to submit infrastructure changes (Terraform, deploys) for odoocker, grovesites, AgenticOS, and future apps — without a human minting a Personal Access Token (PAT) for every task or delegation.
3. **Reduce static-PAT sprawl.** Today, long-lived PATs (DigitalOcean, Cloudflare, etc.) live in 1Password items and `.env` files, non-expiring and un-rotated. We want fewer long-lived secrets and a smaller blast radius.
4. **QA vs Prod separation.** QA-Deploys and Prod-Deploys must have distinct, auditable credential boundaries.

### Findings that shaped the decision

- **DigitalOcean OAuth is a poor fit for on-the-fly scoped tokens.** Its access tokens live **30 days**, scopes are coarse (effectively read/write), there is **no client-credentials / token-exchange / device flow**, and issuance requires a **human authorization-code login**. It cannot mint short-lived per-resource-scoped tokens machine-to-machine.
- **DO's real granularity lives in custom-scoped PATs, not OAuth.** The fine-grained scopes (droplet, app, ssh_key, vpc, monitoring, spaces, …) are a PAT feature.
- **The DO Workload-Identity PoC works only because a broker fronts the DO API.** Its "5-minute scoped tokens" are broker-issued; the long-lived DO credential stays inside the broker (a Caddy reverse-proxy + Vault policy engine). It is an open-source **proof of concept**, not a GA feature, and is built for cross-**droplet** identity — heavier than we need, since our agents are local processes on one droplet.
- **We already run this exact pattern:** `gh-token-broker` holds one long-lived secret (the GitHub App private key) and mints short-lived, repo-scoped tokens on demand over the compose network. Agents never see the root key.
- **1Password Families rate limits force caching.** Read 1,000/hr, write 100/hr per token, and — the binding limit — **1,000 combined reads+writes per 24h per account**. A single `terraform` run reads ~19 secrets, so direct `op read` everywhere would exhaust the daily cap. A caching broker collapses 1Password traffic to a few dozen reads/day regardless of agent volume.
- **1Password Families service-account tokens can be rotated but not given an expiration.** So expiry becomes an operator-enforced rotation policy, mitigated by read-only + single-vault scoping + broker-only isolation.

## Decision

Retire Infisical. Use **1Password (Families) as the secret store**, accessed by a **single read-only, vault-scoped service account**, fronted by a **caching credential broker** — a sibling of `gh-token-broker` — that is the **policy + dynamic-issuance engine**. The broker holds the service-account token and any backing cloud credentials, enforces per-agent / per-project / QA-vs-Prod policy, and issues **ephemeral, scoped** credentials (or proxies the provider API) to agents and CI.

## Options considered

| Option | Kills Infisical bill | Dynamic/ephemeral creds | Identity/policy gating | Net-new ops | Verdict |
| --- | --- | --- | --- | --- | --- |
| **A. Self-host Infisical** | yes (run the container) | via Infisical dynamic secrets | Infisical machine identities | run Infisical | Lowest effort, but keeps a second system and doesn't move us toward the broker end-state |
| **B. 1Password Families + caching broker** (chosen) | yes | via the broker | broker policy | build one broker (reuses gh-token-broker pattern) | Uses tools we already pay for/run; broker is the one net-new piece and we already operate its twin |
| **C. OpenBao (free Vault fork)** | yes | native dynamic secrets | native identity/policy | run + secure OpenBao (unseal/HA/backup/audit) | Cleanest end-state and free, but real ongoing ops burden for a solo operator |

**Why B:** It reuses systems we already have (1Password we pay for regardless; the `gh-token-broker` pattern we already run), makes the one net-new component small and familiar, and keeps the door open to OpenBao (Option C) later if dynamic-secret needs outgrow the broker. HashiCorp Vault itself is excluded on licensing (BSL); the free equivalent is OpenBao.

## Architecture

```text
1Password (Families)                      ← the STORE (human + machine secrets)
  ├─ vaults (per project/env as needed):  agenticos · odoocker · grovesites · qa · prod
  └─ ONE service account: read-only, vault-scoped, rotated quarterly
        │  OP_SERVICE_ACCOUNT_TOKEN  (lives ONLY in the broker, chmod 600)
        ▼
credential broker  (sidecar; models gh-token-broker)   ← POLICY + DYNAMIC ISSUANCE
  ├─ caches backing secrets in memory (long TTL; re-read only on rotation/restart)
  ├─ policy: per-agent identity · per-project · QA vs Prod (Prod may require approval)
  ├─ holds backing cloud creds (e.g. a DO PAT) and mints ephemeral scoped access
  └─ fronts provider APIs / issues short-lived capability tokens
        ▼
consumers:  Paperclip agents · CI (QA/Prod deploys) · terraform
             (never hold the OP token or long-lived provider PATs)
```

## Security model

- **Token isolation.** `OP_SERVICE_ACCOUNT_TOKEN` and backing PATs live only inside the broker, injected as a chmod-600 file — identical handling to the GitHub App private key in `gh-token-broker`. Never in agent env, CI, or `.env`.
- **Least privilege.** The service account is **read-only** and scoped to only the vault(s) the broker needs. A leaked token can read one vault — no writes, no other vaults, no direct provider access.
- **Rotation policy (compensates for no auto-expiry).** Rotate the service-account token on a **quarterly** cadence and immediately on suspected exposure; automate rotation if `op` exposes it programmatically, otherwise a recurring task. Backing provider PATs held by the broker follow the same cadence.
- **Ephemerality for consumers.** Agents/CI receive short-lived, scoped credentials from the broker, never the root secrets.
- **QA vs Prod.** Encoded as broker policy: an agent's identity is auto-granted QA credentials; Prod requires a higher-trust role and/or an explicit approval step before issuance.
- **Audit.** 1Password usage reports show what the service account accessed; the broker logs every issuance (who/what/scope). Anomalies trigger rotation.

## Implementation plan (phased)

- **Phase 0 — unblock today (independent of this ADR).** Mint the 5-scope DO PAT (`droplet, app, ssh_key, vpc, monitoring`, full CRUD) so current Terraform keeps working; store as `do_token_scoped` on the `Grove Infra` item and fix #232's item-name path.
- **Phase 1 — broker skeleton + store access.** Stand up the caching broker on the AgenticOS droplet, modeled on `gh-token-broker`. Create the read-only, vault-scoped 1Password service account; broker reads + caches secrets via `OP_SERVICE_ACCOUNT_TOKEN`.
- **Phase 2 — DO dynamic slice.** Broker holds the DO PAT and mints ephemeral scoped DO access (front the DO API and/or issue short-lived capability tokens). Wire one Paperclip agent end-to-end as proof.
- **Phase 3 — retire Infisical.** Migrate odoocker/grovesites machine secrets into 1Password vault(s); repoint their CI to the broker / service-account token; decommission the Infisical Cloud subscription.
- **Phase 4 — QA/Prod policy + rotation.** Implement the QA-vs-Prod policy split, Prod approval gating, and the rotation automation.

## Consequences

**Positive:** one fewer paid system; one long-lived secret (rotatable, scoped, broker-isolated) instead of PAT sprawl; agents/CI get ephemeral scoped creds with no manual PAT minting; QA/Prod boundary becomes explicit, declarative policy; reuses a pattern we already operate.

**Negative / risks:**

- The broker is now a critical dependency and a single point of failure — needs monitoring and a restart/HA story (note: the AgenticOS droplet is a thin 4 GB box that already OOMs; capacity must be considered).
- No platform-enforced token expiry — rotation discipline is on us.
- Building policy + (optionally) a DO-API reverse proxy is real work; DO API coverage for Terraform through the broker needs validation.
- 1Password Families daily cap makes the broker's cache correctness load-bearing.

## Open questions

1. Can `op` rotate a service-account token programmatically (for automated rotation), or is it UI-only?
2. Does Terraform's DO provider need to route through the broker (endpoint override / HTTP proxy), or is a broker-minted short-lived PAT injected as `TF_VAR_do_token` sufficient?
3. Confirm 1Password Families' exact service-account and Connect limits.
4. Broker language/runtime — reuse the `gh-token-broker` Node stack, or adopt the DO PoC's proxy core for the DO slice?

## Related

- `gh-token-broker` (existing GitHub equivalent) — the pattern this generalizes.
- #232 (GOL-75) scoped DO token — Phase 0 interim.
- DO Workload-Identity PoC (blog + tutorial parts 2 & 3) — reference architecture for the DO slice.
