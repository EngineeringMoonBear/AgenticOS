# Runbook — deploy the credential broker on the AgenticOS droplet

Brings up the `credential-broker` compose service (ADR-0001) on the droplet. The
broker holds one read-only, vault-scoped 1Password service-account token and
serves allowlisted secrets from cache; Phase 2 adds a DigitalOcean scoped-capability
proxy so the DO PAT never leaves the broker.

- Package: `packages/credential-broker/` · service: `credential-broker` (compose profile `credential-broker`)
- Backing identity: `agenticos-broker-ro` (read-only SA; token stored as an `ops_…`
  field on the `AgenticOS Infra` 1Password item — see the Grove Credential Broker vault note)

> These steps run on the **droplet** and touch a secret token. Run them from your
> own terminal — do not paste the `ops_…` token into chat or a shared session.

## Prerequisites

1. **Code on the droplet:** the compose `credential-broker` service (PR #304) and,
   for the DO proxy, PR #309 must be merged to `main`. The droplet builds the
   service from `/opt/agenticos/repo`.
2. **Service account:** `agenticos-broker-ro` exists and is scoped **read-only** to
   the `Goldberry Grove - Admin` vault (it must be able to read every `op://` ref in
   your allowlist). Have its `ops_…` token ready.
3. **A broker API key:** a strong random string consumers present as
   `Authorization: Bearer`. Generate one, e.g. `openssl rand -hex 32`.

## Deploy

```bash
ssh agenticos-droplet          # or your access path to droplet 572389418
sudo mkdir -p /opt/agenticos/secrets && sudo chmod 700 /opt/agenticos/secrets

# 1) Broker-only secrets (chmod 600). Kept OUT of /opt/agenticos/.env.
sudo tee /opt/agenticos/secrets/credential-broker.env >/dev/null <<'EOF'
OP_SERVICE_ACCOUNT_TOKEN=ops_...        # agenticos-broker-ro token
BROKER_API_KEY=...                       # openssl rand -hex 32
EOF
sudo chmod 600 /opt/agenticos/secrets/credential-broker.env

# 2) Allowlist (name -> op:// ref). Start from the repo example and trim to what
#    agenticos-broker-ro can read.
sudo cp /opt/agenticos/repo/packages/credential-broker/secrets-map.example.json \
        /opt/agenticos/secrets/credential-broker-secrets-map.json
sudo "$EDITOR" /opt/agenticos/secrets/credential-broker-secrets-map.json   # remove the _comment key
sudo chmod 600 /opt/agenticos/secrets/credential-broker-secrets-map.json

# 3) Bring it up (the profile keeps it dormant until you ask for it).
cd /opt/agenticos
docker compose --profile credential-broker up -d --build credential-broker
```

## Verify

```bash
docker compose logs --tail=20 credential-broker
#   expect: [broker] listening on :9100 — mode=1password-service-account, secrets=N, ...
#           [broker] DO proxy enabled          (only if a DO PAT name is in the map)

curl -s localhost:9100/health          # {"status":"ok","secrets":N,...}

# Resolve a secret WITHOUT printing its value:
curl -s -H "Authorization: Bearer $BROKER_API_KEY" localhost:9100/secret/do_token_scoped \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('resolved ok — len', len(d.get('value','')), '| cached', d.get('cached'))"
```

- `mode=local-dev` in the logs → `OP_SERVICE_ACCOUNT_TOKEN` didn't load; check the env file.
- `/secret/<name>` → `404` → that name isn't in the allowlist.
- `/secret/<name>` → `502 resolve failed` → the SA can't read that `op://` ref (scope/vault mismatch).

## DigitalOcean proxy (Phase 2, PR #309)

The DO routes are enabled automatically when `do_token_scoped` (or `DO_PAT_SECRET_NAME`)
is in the allowlist. Consumers never see the PAT.

```bash
# From a consumer that can reach the broker over the network:
eval "$(BROKER_URL=http://credential-broker:9100 BROKER_API_KEY=$BROKER_API_KEY \
        /opt/agenticos/repo/packages/credential-broker/client/do-broker-env.sh rw 1200)"
terraform -chdir=infra/terraform apply     # PAT never enters the shell
```

`ro` capabilities allow only GET/HEAD; `rw` allows all methods. Tokens expire
(default 15 m, cap 60 m). Optional broker env: `BROKER_CAPABILITY_SIGNING_KEY`
(HKDF-derived from `BROKER_API_KEY` if unset), `DO_PROXY_DEFAULT_TTL_S` (900),
`DO_PROXY_MAX_TTL_S` (3600).

## Rotation

The 1Password Families service-account token has no expiry — rotate quarterly
(and on suspected exposure):

1. 1Password → Developer → Service Accounts → `agenticos-broker-ro` → issue a new token.
2. Update the `ops_…` value in the `AgenticOS Infra` item and in
   `/opt/agenticos/secrets/credential-broker.env`.
3. `docker compose --profile credential-broker up -d credential-broker` to restart with the new token.

## Update / restart

```bash
cd /opt/agenticos && git -C repo pull    # or your normal deploy path
docker compose --profile credential-broker up -d --build credential-broker
```

## Rollback / stop

```bash
docker compose --profile credential-broker stop credential-broker
docker compose --profile credential-broker rm -f credential-broker
```

Stopping the broker does not affect the rest of the stack — consumers that route
through it (e.g. terraform via the DO proxy) simply fall back to their prior
credential path until it is back up.
