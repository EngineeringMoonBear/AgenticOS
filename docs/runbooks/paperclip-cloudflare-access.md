# Runbook — Paperclip board UI behind Cloudflare Access

Publishes Paperclip's board UI at `https://paperclip.gatheringatthegrove.com`,
gated by Cloudflare Access (Google SSO), and retires the ad-hoc SSH tunnel
(`ssh -N -L 3100:10.116.16.2:3100 …`) previously used to reach `:3100`.

## Architecture

```
browser ─► Cloudflare edge (Access: Google SSO) ─► cloudflared tunnel
                                                        │ (outbound 443 from Droplet)
                                                        ▼
                                            cloudflared service (compose)
                                                        │ http://paperclip-server:3100
                                                        ▼  (internal Docker network)
                                              paperclip-server (better-auth login)
```

Two auth layers by design (defense-in-depth): Cloudflare Access at the edge **and**
Paperclip's own `better-auth` (`PAPERCLIP_DEPLOYMENT_MODE=authenticated`). Expect a
brief double login. The listening socket never faces the internet — only the tunnel
reaches it — so `PAPERCLIP_DEPLOYMENT_EXPOSURE` stays `private`.

**Managed by code:**
- `infra/terraform/cloudflare-tunnel.tf` — tunnel, ingress config, Access app + policy, DNS CNAME, `paperclip_tunnel_token` output.
- `infra/terraform/variables.tf` — `paperclip_domain`, `paperclip_tunnel_secret`.
- `docker-compose.yml` — `cloudflared` service; `PAPERCLIP_PUBLIC_URL` on `paperclip-server`.

**Secrets (1Password → `Goldberry Grove - Admin / AgenticOS Infra`):**
- `paperclip_tunnel_secret` — you generate it; Terraform consumes it.
- `paperclip_tunnel_token` — derived run token (write-once); the Droplet's `.env` consumes it.

`op` lives on the Mac. Never print secret values — the commands below pass them
through pipes/variables, never `echo` them.

---

## First-time setup

### 1. Generate the tunnel secret → 1Password (source of truth)

```bash
op item edit "AgenticOS Infra" --vault "Goldberry Grove - Admin" \
  "paperclip_tunnel_secret[password]=$(openssl rand -base64 32)"
# (use `op item create` instead if the field/item doesn't exist yet)
```

### 2. `terraform apply` — create the Cloudflare side

Prereq: the Google IdP already exists in Zero Trust (the dashboard uses it; see
`cloudflare-access.tf`). From `infra/terraform/`:

```bash
export TF_VAR_paperclip_tunnel_secret=$(op read \
  "op://Goldberry Grove - Admin/AgenticOS Infra/paperclip_tunnel_secret")
# ...alongside the other TF_VARs the stack already needs (see your apply wrapper).
terraform plan    # expect: 1 tunnel, 1 tunnel_config, 1 access_application, 1 access_policy, 1 record
terraform apply
```

### 3. Capture the run token → 1Password (write-once)

```bash
terraform output -raw paperclip_tunnel_token | op item edit "AgenticOS Infra" \
  --vault "Goldberry Grove - Admin" "paperclip_tunnel_token[password]=-"
```

### 4. Push the token into the Droplet's `.env` (no secret printed)

```bash
TOKEN=$(op read "op://Goldberry Grove - Admin/AgenticOS Infra/paperclip_tunnel_token")
ssh deploy@<droplet> 'bash -s' <<EOF
set -e
cd /opt/agenticos
if grep -q '^PAPERCLIP_TUNNEL_TOKEN=' .env; then
  sed -i "s|^PAPERCLIP_TUNNEL_TOKEN=.*|PAPERCLIP_TUNNEL_TOKEN=${TOKEN}|" .env
else
  echo "PAPERCLIP_TUNNEL_TOKEN=${TOKEN}" >> .env
fi
# verify presence/length only — never the value:
echo "PAPERCLIP_TUNNEL_TOKEN length: \$(grep '^PAPERCLIP_TUNNEL_TOKEN=' .env | cut -d= -f2- | wc -c)"
EOF
```

### 5. Deploy the new compose state on the Droplet

Pull the merged branch onto the Droplet (or copy `docker-compose.yml`), then:

```bash
ssh deploy@<droplet>
cd /opt/agenticos
# `up -d`, NOT `docker restart`: restart does not re-read env_file/compose changes,
# so PAPERCLIP_PUBLIC_URL and the new cloudflared service wouldn't take.
docker compose up -d paperclip-server   # picks up PAPERCLIP_PUBLIC_URL
docker compose up -d cloudflared         # starts the connector
docker compose logs -f cloudflared       # expect: "Registered tunnel connection" x4
```

### 6. Validate

- `https://paperclip.gatheringatthegrove.com` → Google (Access) → Paperclip login → board UI.
- Confirm **no login loop** (proves `better-auth` accepted `PAPERCLIP_PUBLIC_URL` for cookie domain / trustedOrigins).
- `docker compose ps cloudflared` → healthy/running; no ports published.

### 7. Retire the SSH tunnel

Once the hostname works, stop using `ssh -N -L 3100:10.116.16.2:3100 …`. Note
`scripts/sync-paperclip-secrets.sh` defaults `PAPERCLIP_BASE=http://localhost:3100`
(the old tunnel) — run it with `PAPERCLIP_BASE=https://paperclip.gatheringatthegrove.com`
**or** keep a short-lived tunnel just for that script until it's repointed.

---

## Reprovision (fresh Droplet)

`PAPERCLIP_PUBLIC_URL` ships in `docker-compose.yml` (no action). The tunnel
**secret** and **token** already exist in 1Password and the tunnel resource is in
Terraform state — so on a rebuild, only **step 4** (push `PAPERCLIP_TUNNEL_TOKEN`
into the new `.env`) then **step 5** are needed. Do not re-run `apply` expecting a
new token; the token is stable for the life of the tunnel.

## Rotating the tunnel secret

Re-run step 1 with a fresh `openssl rand`, `terraform apply` (new token), then
steps 3–5. The old token stops working once the new secret is applied.
