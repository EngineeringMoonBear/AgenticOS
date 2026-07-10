# Phase 2 — Credential broker DO dynamic slice (scoped-capability reverse proxy)

- **Date:** 2026-07-10
- **Status:** Approved (design)
- **Owner:** Josh (operator)
- **ADR:** [ADR-0001](../../adr/0001-credential-brokering-and-secret-store.md) — this is its "Phase 2 — DO dynamic slice."
- **Builds on:** `packages/credential-broker/` (Phase 1 scaffold, PR #304 — `broker.mjs` pure core, `main.mjs` entry, verified live 2026-07-10).

## Problem

Phase 1's `GET /secret/do_token_scoped` hands the **real** long-lived DigitalOcean PAT to the caller. Every `terraform apply` today pulls that PAT into the operator's shell via `load-secrets.sh`. We want the PAT to **never leave the broker**, and callers to receive **ephemeral, scoped** access instead.

### The constraint that shapes the design

DigitalOcean **cannot mint short-lived scoped tokens via API**: OAuth issues 30-day, coarse-scoped tokens and requires a human authorization-code login; there is no client-credentials / token-exchange / device flow; fine scoping lives only in manually-created PATs. Therefore the ADR's literal `/token/digitalocean` "hand out a smaller DO token" endpoint is **infeasible**.

The only way to keep the PAT inside the broker is a **scoped-capability reverse proxy**: the broker fronts the DO API, the caller presents a short-lived **broker-issued capability token**, and the broker injects the real PAT server-side before forwarding. This mirrors the DO Workload-Identity PoC (a broker fronting the DO API with the long-lived credential inside it).

## Decision (settled during brainstorming)

1. **Model:** scoped-capability reverse proxy (forced by the constraint above).
2. **First consumer:** Terraform. The DO provider supports `api_endpoint` (env `DIGITALOCEAN_API_URL`, default `https://api.digitalocean.com`) and `token` (env `DIGITALOCEAN_TOKEN`), so Terraform routes through the broker with **zero code changes** — two env vars.
3. **Capability model:** HMAC-signed, short-lived, **coarse** `ro|rw` scope. Not a full per-resource-type policy engine (deferred).

## Architecture

A new module `packages/credential-broker/src/do-proxy.mjs` sits beside `broker.mjs`. `broker.mjs` is **unchanged** — it keeps its single job (serve allowlisted secrets). `main.mjs` mounts two new routes on the same service and port (9100):

| Method | Path                     | Auth                     | Purpose                              |
|--------|--------------------------|--------------------------|--------------------------------------|
| POST   | `/token/digitalocean`    | `BROKER_API_KEY` bearer  | Mint a capability token              |
| ALL    | `/do/*`                  | capability token bearer  | Proxy to DigitalOcean, inject PAT    |

```
1. mint:   caller --Bearer BROKER_API_KEY--> POST /token/digitalocean {scope,ttl}
                                             <-- {token, scope, expiresAt}
2. use:    terraform (DIGITALOCEAN_API_URL=<broker>/do, DIGITALOCEAN_TOKEN=<capability>)
              --Bearer capability--> ALL /do/v2/*
                 broker: verify sig+exp, enforce method vs scope, strip capability,
                         inject real do_token_scoped, forward --> api.digitalocean.com
                 <-- upstream status + body streamed back
```

The real `do_token_scoped` is obtained through the broker's existing **cached** secret path (the same `getSecret("do_token_scoped")` used by `/secret/*`), so the proxy also honors the Families rate-cap cache — one upstream 1Password read regardless of terraform call volume.

## Component design

### `do-proxy.mjs` (new, pure/injectable)

Exports a factory so it is unit-testable with no network and no real crypto keys wired at import:

```
createDoProxy({
  signingKey,        // string — HMAC key for capability tokens
  resolvePat,        // async () => string — returns the real DO PAT (from broker cache)
  now = Date.now,    // injectable clock
  fetchImpl = fetch, // injectable upstream fetch (tests stub it)
  upstream = "https://api.digitalocean.com",
  maxTtlMs = 60*60*1000,
  defaultTtlMs = 15*60*1000,
}) -> { mint(req,res), proxy(req,res), signToken(payload), verifyToken(str) }
```

- `signToken({scope, exp})` → `v1.<b64url(JSON payload)>.<b64url(HMAC-SHA256(payload, signingKey))>`. Stateless — no server store, survives restart.
- `verifyToken(str)` → `{ok, payload|error}`; constant-time signature compare; rejects bad version, bad signature, malformed, or `exp <= now`.

### Capability token

- Payload: `{ "scope": "ro"|"rw", "exp": <unix seconds>, "iss": "agenticos-broker" }`.
- Signed with `BROKER_CAPABILITY_SIGNING_KEY`. If that env is unset, derive it via HKDF-SHA256 from `BROKER_API_KEY` (`info = "credential-broker/do-capability/v1"`) so there is **no hard new secret to provision** — but a dedicated key is supported and recommended for prod.
- No 1Password round-trip to verify (stateless signature), so minting/verifying is free against the Families cap.

### Mint endpoint — `POST /token/digitalocean`

- Auth: `Authorization: Bearer $BROKER_API_KEY` (same constant-time check as `/secret/*`). 401 otherwise.
- Params (JSON body or query): `scope` ∈ `{ro, rw}` (default `ro`); `ttl` seconds (default 900, hard-capped at 3600 — larger requests are clamped, not rejected, and the response states the granted value).
- Response `200`: `{ "token": "v1.…", "scope": "ro", "expiresAt": "<ISO8601>" }`.
- Unknown scope → `400`.

### Proxy endpoint — `ALL /do/*`

1. Read capability token from `Authorization: Bearer`. Missing/invalid/expired → `401` `{error}`.
2. **Scope enforcement:** `ro` → allow only `GET`/`HEAD`; any write method → `403` `{error:"capability is read-only"}`. `rw` → all methods.
3. Rewrite path: strip the `/do` prefix; `/do/v2/droplets?x=1` → `${upstream}/v2/droplets?x=1`.
4. Forward with: original method, query, and (for write methods) the buffered request body; `Authorization: Bearer <real PAT>` injected; `Content-Type` preserved; hop-by-hop and inbound `Authorization`/`Host` headers dropped. **Upstream host is hardcoded** — the proxy can never be aimed at another host.
5. Stream upstream status code + body back to the caller. Upstream/network error → `502` `{error}`.

### Terraform wiring — `client/do-broker-env.sh`

Mints a token and prints shell exports (mirrors `broker-get.sh` — prints only what's needed, the capability token is short-lived and non-reusable after expiry):

```bash
# usage: eval "$(BROKER_URL=… BROKER_API_KEY=… ./client/do-broker-env.sh <ro|rw> [ttl-seconds])"
#   emits:  export DIGITALOCEAN_API_URL="$BROKER_URL/do"
#           export DIGITALOCEAN_TOKEN="<minted capability token>"
# ttl-seconds defaults to DO_PROXY_DEFAULT_TTL_S (900) and is clamped to DO_PROXY_MAX_TTL_S (3600).
```

Operator flow (no terraform code change):
```bash
eval "$(BROKER_URL=http://credential-broker:9100 BROKER_API_KEY=… ./client/do-broker-env.sh rw 1200)"
terraform -chdir=infra/terraform apply     # PAT never enters the shell
```

## Configuration (new env, all broker-side)

| Env                             | Required | Default                    | Meaning                                   |
|---------------------------------|----------|----------------------------|-------------------------------------------|
| `BROKER_CAPABILITY_SIGNING_KEY` | no       | HKDF from `BROKER_API_KEY` | HMAC key for capability tokens            |
| `DO_PAT_SECRET_NAME`            | no       | `do_token_scoped`          | secrets-map name the proxy resolves as the PAT |
| `DO_PROXY_MAX_TTL_S`            | no       | `3600`                     | hard cap on capability lifetime           |
| `DO_PROXY_DEFAULT_TTL_S`        | no       | `900`                      | default capability lifetime               |

`do-proxy` is enabled whenever `do_token_scoped` (or `DO_PAT_SECRET_NAME`) resolves; otherwise the two routes return `503 {error:"DO proxy not configured"}` and the broker still serves `/secret/*` and `/health`.

## Security properties

- Real PAT never leaves the broker; callers hold only expiring capability tokens.
- `ro`/`rw` method gate at the proxy.
- Upstream host fixed → proxy can't be repurposed as an open relay.
- Signing key and PAT are both broker-only (chmod-600 env file), same handling as `gh-token-broker`'s App key.
- **Documented limitation:** scope is coarse (`ro`/`rw`), NOT per-resource-type. A `rw` capability can touch any DO resource the underlying PAT can (droplet/app/ssh_key/vpc/monitoring). Acceptable because the PAT is already least-privilege (GOL-75) and this increment targets terraform (which needs broad write anyway). Per-resource scoping is deferred.

## Testing

`test/do-proxy.test.mjs`, `node --test`, no network (fetch + clock injected):

- sign→verify roundtrip returns the payload
- tampered payload/signature → reject
- expired (`exp <= now`) → reject
- unknown version prefix → reject
- mint requires `BROKER_API_KEY` (401 without)
- mint clamps `ttl` to `DO_PROXY_MAX_TTL_S`; unknown scope → 400
- proxy: `ro` capability + `POST` → 403; `ro` + `GET` → forwarded
- proxy: `rw` + `DELETE` → forwarded
- proxy injects the real PAT into the upstream `Authorization` header and strips the inbound capability (assert via the fetch stub)
- proxy path rewrite (`/do/v2/x?q` → `${upstream}/v2/x?q`)
- upstream throw → 502
- routes return 503 when no PAT configured

`broker.mjs` and its tests are untouched.

## In scope / out of scope

**In:** `do-proxy.mjs` + the two routes in `main.mjs`; `client/do-broker-env.sh`; unit tests; README section; the compose service already covers it (same container, new routes — no new service). Docs: add the proxy usage to the broker README and note terraform routing in `infra/README.md`.

**Out (follow-ups, noted so they aren't mistaken for done):**
- Per-resource-type / method-path scoping and a real policy engine.
- The Paperclip-agent consumer (curated command surface).
- Per-identity policy (map capability/API key → allowed scopes/consumers).
- Request audit log of proxied calls.
- Per-stage (QA/Prod) capability issuance — folds in when the per-stage vaults from the [ADR-0001 amendment](../../adr/0001-credential-brokering-and-secret-store.md) exist.

## Rollout

1. Land `do-proxy.mjs` + routes + tests behind the existing service (dormant `credential-broker` profile — no behavior change until the proxy is used).
2. Operator smoke-test locally via `dev-run.sh` + `do-broker-env.sh` against a `ro` capability (`GET /do/v2/account` denied by the scoped PAT is the expected proof it's the *scoped* identity).
3. Only once proven: switch `load-secrets.sh` / CI terraform to route through the broker (a later change — this spec does not modify the terraform runtime path).
