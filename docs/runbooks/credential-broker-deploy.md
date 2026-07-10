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

# 0) Make sure the broker SOURCE is in the live tree — merges to
#    packages/credential-broker/** do NOT auto-deploy (see "Update / restart").
git -C /opt/agenticos/repo checkout main && git -C /opt/agenticos/repo pull --ff-only
cp -a /opt/agenticos/repo/packages/credential-broker/. /opt/agenticos/packages/credential-broker/

sudo mkdir -p /opt/agenticos/secrets && sudo chmod 700 /opt/agenticos/secrets

# 1) Broker-only secrets. Compose runs as the `deploy` user, so the files MUST be
#    deploy-owned — root-owned files (from `sudo tee`) cause "permission denied" at `up`.
#    The SA token is ~852 chars; copy the WHOLE value — a truncated paste base64-fails.
#    Cleanest is to pipe it (no manual copy) from your LOCAL mac where `op` works:
#      TOKEN=$(op read "op://Goldberry Grove - Admin/AgenticOS Infra/agenticos-broker-ro_token" | tr -d '\r\n')
#      printf 'OP_SERVICE_ACCOUNT_TOKEN=%s\nBROKER_API_KEY=%s\n' "$TOKEN" "$(openssl rand -hex 32)" \
#        | ssh agenticos-droplet 'cat > /tmp/cb.env'
#    then, back on the droplet:
sudo install -o deploy -g deploy -m 600 /tmp/cb.env /opt/agenticos/secrets/credential-broker.env && rm -f /tmp/cb.env

# 2) Allowlist (name -> op:// ref), deploy-owned + 600. Trim to what agenticos-broker-ro can read.
sudo cp /opt/agenticos/repo/packages/credential-broker/secrets-map.example.json \
        /opt/agenticos/secrets/credential-broker-secrets-map.json
sudo nano /opt/agenticos/secrets/credential-broker-secrets-map.json   # delete the "_comment" line
sudo chown deploy:deploy /opt/agenticos/secrets/credential-broker-secrets-map.json
sudo chmod 600 /opt/agenticos/secrets/credential-broker-secrets-map.json
python3 -m json.tool /opt/agenticos/secrets/credential-broker-secrets-map.json >/dev/null && echo "valid JSON"

# 3) Bring it up (the profile keeps it dormant until you ask for it).
cd /opt/agenticos && docker compose --profile credential-broker up -d --build credential-broker
```

## Verify

The broker publishes **no host port** (internal-only, like `gh-token-broker`) — it is
reachable only on the compose network at `credential-broker:9100`. So `curl localhost:9100`
from the droplet host returns nothing; verify via the healthcheck and an in-container probe.

```bash
docker compose logs --tail=20 credential-broker
#   expect: [broker] listening on :9100 — mode=1password-service-account, secrets=N, ...
#           [broker] DO proxy enabled          (only if a DO PAT name is in the map)

# Healthcheck verdict (compose hits /health internally every 30s):
docker compose ps credential-broker              # STATUS: Up (healthy)

# Resolve a secret WITHOUT printing its value — run INSIDE the container network:
BK=$(sudo grep -oP '(?<=^BROKER_API_KEY=).*' /opt/agenticos/secrets/credential-broker.env)
docker compose exec -e BK="$BK" credential-broker node -e \
  "fetch('http://127.0.0.1:9100/secret/do_token_scoped',{headers:{authorization:'Bearer '+process.env.BK}}).then(r=>r.json()).then(d=>console.log(d.value?('resolve OK len='+d.value.length+' cached='+d.cached):JSON.stringify(d)))"
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

`/opt/agenticos` is an rsync/tarball snapshot and `/opt/agenticos/packages` is a **real
directory**, not a symlink to `repo/`. Broker source lives under `packages/credential-broker/**`,
which is **not** in `deploy-droplet.yml`'s trigger paths — so merging broker changes to `main`
does **not** auto-ship them. Refresh the live tree by hand, then rebuild:

```bash
git -C /opt/agenticos/repo checkout main && git -C /opt/agenticos/repo pull --ff-only
# copy the updated broker package into the live build context:
cp -a /opt/agenticos/repo/packages/credential-broker/. /opt/agenticos/packages/credential-broker/
ls /opt/agenticos/packages/credential-broker/src/    # confirm the expected files are present

cd /opt/agenticos && docker compose --profile credential-broker up -d --build credential-broker
```

A plain restart with no source change (e.g. after rotating the token) needs no `--build`:
`docker compose --profile credential-broker up -d credential-broker`.

## Rollback / stop

```bash
docker compose --profile credential-broker stop credential-broker
docker compose --profile credential-broker rm -f credential-broker
```

Stopping the broker does not affect the rest of the stack — consumers that route
through it (e.g. terraform via the DO proxy) simply fall back to their prior
credential path until it is back up.
