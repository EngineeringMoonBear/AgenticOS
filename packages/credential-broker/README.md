# credential-broker

ADR-0001, Phase 1. A sidecar that holds **one** read-only, vault-scoped 1Password
service-account token and serves **allowlisted** secrets to the rest of the stack
from an in-memory cache. It is the generalization of `gh-token-broker` (which does
the same thing for GitHub App installation tokens) to arbitrary 1Password secrets.

## Why this exists

- **Rate cap.** 1Password Families allows ~1000 reads/day/account. Wiring every
  agent, terraform run, and CI job to raw `op read` burns that fast. The broker
  reads each secret **once** and serves it from cache for its TTL — N callers cost
  ~1 upstream read, not N.
- **Blast radius.** Only the broker holds the service-account token (in a
  chmod-600 file, never `/opt/agenticos/.env`). Consumers authenticate to the
  broker with a separate `BROKER_API_KEY` and can fetch only the names on the
  allowlist. A compromised consumer gets, at most, the pre-declared set — read-only.

## Security model (Phase 1)

1. **Allowlist, not proxy.** The broker resolves only names present in
   `secrets-map.json` (name → `op://` ref). It will never resolve an arbitrary
   `op://` ref handed to it by a caller. Adding a secret is a reviewed config change.
2. **Bearer auth.** Every `/secret/*` request needs `Authorization: Bearer $BROKER_API_KEY`.
   Compared in constant time. `/health` is the only unauthenticated route and it
   never touches upstream.
3. **Scoped backing identity.** The service account is read-only and scoped to the
   single `Goldberry Grove - Admin` vault (see the ADR / infra README). The broker
   can't reach anything outside it even if the token leaks from the container.

## Endpoints

| Method | Path             | Auth   | Returns                                              |
|--------|------------------|--------|-----------------------------------------------------|
| GET    | `/health`        | none   | `{status, secrets, upstreamReads, cacheHits}`       |
| GET    | `/secret/:name`  | Bearer | `{value, cached}` for an allowlisted name; 404 else |

## Running

**Production / QA — 1Password machine identity:**

```bash
export OP_SERVICE_ACCOUNT_TOKEN='ops_...'   # read-only, vault-scoped (chmod-600 file)
export BROKER_API_KEY='...'                  # what consumers present
export SECRETS_MAP_FILE=./secrets-map.json   # cp from secrets-map.example.json
npm install && npm start
```

**Local dev — no token, no 1Password round-trip:**

```bash
export BROKER_API_KEY='dev'
export LOCAL_SECRETS_FILE=./local-secrets.json   # {"do_token_scoped":"dop_v1_...", ...}
npm start   # logs a loud LOCAL MODE warning; serves the dev file
```

**Fetch a secret (consumer side):**

```bash
BROKER_URL=http://credential-broker:9100 BROKER_API_KEY=... \
  client/broker-get.sh do_token_scoped        # prints only the value
# composes into terraform:
export TF_VAR_do_token="$(client/broker-get.sh do_token_scoped)"
```

## Config

| Env                        | Required | Default              | Meaning                                        |
|----------------------------|----------|----------------------|------------------------------------------------|
| `BROKER_API_KEY`           | yes      | —                    | Bearer key consumers present                   |
| `OP_SERVICE_ACCOUNT_TOKEN` | prod     | —                    | 1Password backing token (enables SDK mode)     |
| `SECRETS_MAP_FILE`         | prod     | `/app/secrets-map.json` | allowlist: name → `op://` ref               |
| `LOCAL_SECRETS_FILE`       | dev      | —                    | name → value JSON (local mode; no token)       |
| `CACHE_TTL_MS`             | no       | `3600000` (1h)       | per-secret cache lifetime                      |
| `PORT`                     | no       | `9100`               | listen port                                    |

## Tests

```bash
node --test        # pure unit tests: cache, TTL, allowlist, auth, resolver failure
```

No SDK or network needed — `broker.mjs` takes the resolver and clock as injected
dependencies (see `test/broker.test.mjs`).

## Roadmap (not in this scaffold)

- **Phase 2 — per-consumer policy:** map `BROKER_API_KEY` → which subset of names
  each caller may fetch (agents ≠ terraform ≠ CI), instead of one shared key.
- **Phase 2 — ephemeral DO tokens:** a `/token/digitalocean?scope=...` route that
  mints short-lived scoped DO PATs on demand (mirrors gh-token-broker's model),
  so the long-lived `do_token_scoped` never leaves the broker.
- **Migration:** point odoocker / grove-sites secret loaders at the broker and
  retire Infisical.

## Relationship to the rest of the stack

- `gh-token-broker` — sibling; GitHub App tokens. Same "only-I-hold-the-secret" shape.
- `infra/scripts/load-secrets.sh` — the interactive/CI terraform loader; already
  service-account-aware. Low-frequency (~19 reads/apply) so it may read 1Password
  directly; **high-frequency callers belong behind this broker.**
