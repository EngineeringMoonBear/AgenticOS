# ADR-0001: Secret store + credential brokering (retire Infisical; 1Password + caching broker)

- **Status:** Proposed
- **Date:** 2026-07-07
- **Deciders:** Josh (CEO/operator)
- **Scope:** AgenticOS, odoocker, grovesites, and future apps + their QA/Prod deploy pipelines

> **Amendment 2026-07-10 — QA/Prod isolation via per-stage vaults.** The original
> design used **one** read-only, single-vault service account and enforced the
> QA-vs-Prod boundary purely in **broker policy** (the broker refuses Prod creds to
> a caller lacking the `production` OIDC claim). We evaluated 1Password
> **Environments** for finer granularity and rejected it: its composition model is
> stored key-value copies (a second source of truth → drift, our known failure
> mode) and it abandons the `op://` reference the whole stack is built on. Instead
> we make the boundary **physical at the 1Password layer** using the vault-scoping
> primitive we already use: **one vault per stage** (`Grove QA`, `Grove Prod`) and
> **one read-only service account scoped to each** (`grove-broker-qa-ro`,
> `grove-broker-prod-ro`). The QA identity cannot read the Prod vault even if the
> broker's policy code is wrong — defense in depth. Sections below reflect this;
> the phased plan is updated accordingly.

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

Retire Infisical. Use **1Password (Families) as the secret store**, accessed by **read-only, vault-scoped service accounts — one per deploy stage** (see the 2026-07-10 amendment), fronted by a **caching credential broker** — a sibling of `gh-token-broker` — that is the **policy + dynamic-issuance engine**. The broker holds the service-account token(s) and any backing cloud credentials, enforces per-agent / per-project / QA-vs-Prod policy, and issues **ephemeral, scoped** credentials (or proxies the provider API) to agents and CI. QA-vs-Prod separation is **physical** (the QA service account is scoped to the `Grove QA` vault and literally cannot read `Grove Prod`), with broker policy + GitHub Environments as additional gates on top.

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
  ├─ per-stage vaults:  Grove QA · Grove Prod   (+ shared/admin vault as needed)
  └─ ONE read-only service account PER STAGE, each scoped to exactly its vault,
     rotated quarterly:  grove-broker-qa-ro → Grove QA ; grove-broker-prod-ro → Grove Prod
        │  OP_SERVICE_ACCOUNT_TOKEN (per stage; lives ONLY in the broker, chmod 600)
        ▼
credential broker  (sidecar; models gh-token-broker)   ← POLICY + DYNAMIC ISSUANCE
  ├─ selects the stage's backing SA token by the caller's identity/OIDC `environment` claim
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
- **Least privilege + physical stage isolation.** Each service account is **read-only** and scoped to **exactly one stage vault**. A leaked QA token can read only `Grove QA` — no writes, no Prod vault, no other vaults, no direct provider access. The QA↔Prod boundary is enforced by 1Password itself, not by broker code being correct.
- **Rotation policy (compensates for no auto-expiry).** Rotate the service-account token on a **quarterly** cadence and immediately on suspected exposure; automate rotation if `op` exposes it programmatically, otherwise a recurring task. Backing provider PATs held by the broker follow the same cadence.
- **Ephemerality for consumers.** Agents/CI receive short-lived, scoped credentials from the broker, never the root secrets.
- **QA vs Prod.** Three independent gates: (1) **physical** — the stage's read-only SA is scoped to only that stage's vault; (2) **broker policy** — auto-grants QA, requires a higher-trust role/approval for Prod; (3) **GitHub Environments** — Prod jobs held behind required reviewers before they can obtain the `production` claim. Any one failing does not breach the boundary.
- **Audit.** 1Password usage reports show what the service account accessed; the broker logs every issuance (who/what/scope). Anomalies trigger rotation.

## Deploy pipelines: QA-Deploy and Prod-Deploy

Both are CI pipelines (GitHub Actions) for odoocker, grovesites, and AgenticOS. **Neither holds static secrets.** Each authenticates to the broker via **GitHub Actions OIDC** — the native, signed, short-lived JWT (`id-token: write`) carrying `repository`, `ref`, and `environment` claims — and the broker issues ephemeral, environment-scoped credentials. This is the same workload-identity idea as the DO droplet PoC, but the identity source is GitHub instead of a droplet's SSH key.

- **QA-Deploy.** The job requests an OIDC token with `environment: qa`. The broker validates the repo + `environment=qa` claim and reads through the **`grove-broker-qa-ro`** service account → **`Grove QA`** vault, issuing **QA-scoped** credentials (QA vault secrets, QA DO project/resources). **Auto-approved** — no human gate. Even a bug here cannot reach Prod: the QA SA has no access to `Grove Prod`.
- **Prod-Deploy.** The job targets a GitHub **Environment `production`** protected by **required reviewers**. GitHub holds the job at the environment gate until a human approves; only then does it run, obtain an OIDC token with `environment: production`, and the broker — seeing that claim — reads through the **`grove-broker-prod-ro`** SA → **`Grove Prod`** vault and issues **Prod-scoped** credentials. Prod is thus gated in **three** independent places: GitHub Environments (human approval), broker policy (refuses Prod creds without the `production` claim), and 1Password vault scoping (only the Prod SA can read `Grove Prod`).

Net: one broker, two identity-bearing caller types (Paperclip agents via compose-network identity; CI via GitHub OIDC), one policy engine, environment separation by claim, and Prod gated by a human approval enforced in two independent places.

## Local development on OrbStack (non-negotiable)

Local dev must **always** work on OrbStack with **zero dependency** on the prod broker, the scoped service account, network to 1Password's prod path, or the Families daily rate cap.

- The broker is a **first-class compose service** that runs in *every* environment — local OrbStack, QA, Prod — exactly as `gh-token-broker` and the other services do today. Consumers (agents, terraform, deploy scripts) always talk to the broker over the compose network, so there is **no code difference** between local and prod; only the broker's backing config changes.
- The broker supports a **local backing mode**: on OrbStack it resolves secrets from the developer's own source — interactive `op` (personal account), a dedicated dev vault, or a git-ignored `.env.local` of non-prod dev values — **never** the prod service-account token. So `docker compose up` on OrbStack always brings up a working stack, offline-friendly, with no prod-credential dependency.
- This generalizes the existing `load-secrets.sh` tiering (Tier 1: 1Password CLI): same interface everywhere, backing source swapped per environment via one env var.
- **Guardrail:** a local/dev run resolves **only** non-prod secrets; the prod service-account token and prod vault are never mounted into an OrbStack run. Prod creds require a prod identity (the service account, or a `production` OIDC claim) that a local run cannot present.

## Implementation plan (phased)

- **Phase 0 — unblock today (independent of this ADR).** Mint the 5-scope DO PAT (`droplet, app, ssh_key, vpc, monitoring`, full CRUD) so current Terraform keeps working; store as `do_token_scoped` on the `Grove Infra` item and fix #232's item-name path.
- **Phase 1 — broker skeleton + store access + local mode.** Stand up the caching broker as a compose service (modeled on `gh-token-broker`) that runs identically on OrbStack, QA, and Prod. Create the **per-stage** read-only, vault-scoped 1Password service accounts (`grove-broker-qa-ro` → `Grove QA`, `grove-broker-prod-ro` → `Grove Prod`); broker reads + caches secrets via the stage's `OP_SERVICE_ACCOUNT_TOKEN` in QA/Prod, and via a **local backing mode** (dev `op` / dev vault / `.env.local`) on OrbStack. Prove `docker compose up` works locally with no prod-credential dependency. (Broker scaffold: #304. First stage vault + SA is the operator step that activates it.)
- **Phase 2 — DO dynamic slice.** Broker holds the DO PAT and mints ephemeral scoped DO access (front the DO API and/or issue short-lived capability tokens). Wire one Paperclip agent end-to-end as proof.
- **Phase 3 — retire Infisical.** Migrate odoocker/grovesites machine secrets into 1Password vault(s); repoint their CI to the broker / service-account token; decommission the Infisical Cloud subscription.
- **Phase 4 — QA/Prod CI via OIDC + rotation.** Wire QA-Deploy and Prod-Deploy to authenticate to the broker with **GitHub Actions OIDC** (no static CI secrets); gate Prod behind a GitHub **Environment `production`** with required reviewers, and enforce the same `environment` claim in broker policy. Implement token rotation (automated if `op` supports it, else scheduled).

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
3. Confirm 1Password Families' exact service-account and Connect limits — specifically the **max number of vaults and service accounts** the plan allows, since per-stage isolation needs ≥2 of each (QA + Prod, plus the existing admin vault). Single-vault SAs already work on the plan; this is a count check. If the plan caps SAs too low, fall back to per-stage *vaults* with the broker selecting creds by claim within one SA scoped to both (weaker isolation — note it explicitly).
4. **Rejected: 1Password Environments.** Evaluated 2026-07-10 for QA/Prod granularity; rejected because its variables appear to be stored key-value **copies** (second source of truth → drift) rather than `op://` references. Per-stage vaults give the same isolation on the reference model we already use. Revisit only if 1Password documents Environments composed *from* vault-item references.
4. Broker language/runtime — reuse the `gh-token-broker` Node stack, or adopt the DO PoC's proxy core for the DO slice?

## Related

- `gh-token-broker` (existing GitHub equivalent) — the pattern this generalizes.
- #232 (GOL-75) scoped DO token — Phase 0 interim.
- DO Workload-Identity PoC (blog + tutorial parts 2 & 3) — reference architecture for the DO slice.
