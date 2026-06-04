# AgenticOS Infrastructure (Terraform + cloud-init)

This directory provisions the AgenticOS Foundation v2 MVP infrastructure end-to-end.
After a successful `terraform apply`, one manual step remains:
SSH to the Droplet and complete the Codex OAuth flow so Hermes can reach
ChatGPT for agent reasoning. (Hermes supports 40+ LLM providers; we currently use
`provider: openai-codex` for its flat subscription cost model.)

## What gets provisioned

- **DigitalOcean**
  - VPC `agenticos-vpc` (region `nyc1` by default)
  - SSH key `agenticos-droplet-key`
  - Droplet `agenticos-droplet` (Ubuntu 24.04, `s-2vcpu-4gb`, in the VPC)
  - App Platform app `agenticos-dashboard` tracking `EngineeringMoonBear/AgenticOS@main`
- **Tailscale**
  - Pre-authorized, single-use auth key tagged `tag:agenticos-droplet`
  - Droplet joins the tailnet automatically via cloud-init
- **Cloudflare**
  - Proxied A record `agenticos.gatheringatthegrove.com`
  - Zero Trust Access application + "Allow Josh" policy gating the hostname behind Google SSO
- **Droplet (via cloud-init)**
  - Hardened SSH, UFW baseline, unattended-upgrades, fail2ban
  - Docker Engine + Compose
  - Tailscale (joined with auth key, no browser interaction)
  - Syncthing (user-service for `deploy`, GUI exposed only on `tailscale0`)
  - Node 22, pnpm 9.15.4, OpenAI Codex CLI (Hermes' `openai-codex` provider can import the CLI's OAuth credentials from `~/.codex/auth.json` if present)
  - Filesystem layout: `/opt/agenticos/repo`, `/opt/vault`, `/opt/backups`, `/etc/agenticos`
  - Repo cloned to `/opt/agenticos/repo`
  - AgenticOS docker-compose stack started if `docker-compose.yml` exists in the repo. Services: Postgres (`agenticos-db`, cost telemetry), Ollama (embeddings), OpenViking (`:1933`, agent memory), vault-server (`:7779 → 7777`, human Obsidian vault API), Hermes Agent + hermes-gateway (orchestration + cron tick), and inbox-watcher. The VPC-bound services (Postgres `:5432`, OpenViking `:1933`, vault-server `:7779`) are gated by UFW to `10.116.16.0/20` — see "UFW rules for VPC-bound services" below.
  - Cron jobs registered via `hermes cron create` (daily-brief, cost-report)

## Deploys

Two independent surfaces, two deploy paths:

- **Dashboard (App Platform)** — auto-deploys on every push to `main`. No action needed.
- **Droplet services (vault-server)** — auto-deployed by `.github/workflows/deploy-droplet.yml`.
  It triggers on push to `main` when `infra/vault-server/**`, `packages/vault-core/**`,
  or the root `docker-compose.yml` change. The workflow SSHes to the Droplet with a
  dedicated deploy key (`DROPLET_SSH_KEY` secret), ships the committed tree via
  `git archive | ssh tar` (additive — preserves Droplet-only `.env` and `hermes-config/`),
  rebuilds + restarts the changed service, and runs a `/health` check against the VPC
  endpoint `10.116.16.2:7779`. Manual run: `gh workflow run deploy-droplet.yml`.

  Required GitHub secrets: `DROPLET_SSH_KEY` (private deploy key), `DROPLET_HOST`,
  `DROPLET_USER`. The deploy key is a dedicated, passwordless ed25519 key whose public
  half is in the Droplet's `deploy@` `authorized_keys` — separate from the operator's
  interactive key.

## Cost

- Droplet `s-2vcpu-4gb`: **$24/mo**
- App Platform `basic-xxs`: **$5/mo**
- Tailscale free tier, Cloudflare Access free tier, Syncthing free → **$0/mo**
- **Total: ~$29/mo**

## Prerequisites

### 1. Install tooling

```bash
brew install terraform doctl   # doctl is optional, useful for CLI checks
terraform version              # require >= 1.6
```

### 2. Generate the SSH key

```bash
ssh-keygen -t ed25519 -f ~/.ssh/agenticos-droplet -C "agenticos-droplet"
```

### 3. Create three API tokens

**DigitalOcean** (DO Console → API → Tokens → Generate New Token):
- Scopes: full read+write
- Save as `do_token`

**Tailscale**:
- API key: <https://login.tailscale.com/admin/settings/keys> → Generate API key.
  Scope: `auth_keys:write`. Save as `tailscale_api_key`.
- Tailnet identifier (save as `tailscale_tailnet`): use one of:
  - **Your tailnet name** (recommended) — the domain-style or email-shaped string
    Tailscale assigned. For Goldberry Grove that's `goldberrygrove.farm`.
    Find it at <https://login.tailscale.com/admin/general> under "Tailnet name"
    (NOT "Tailnet ID" — that's a different value the REST API does not accept
    in URL paths, despite what the concepts doc implies).
  - **Literal `-`** — wildcard meaning "the tailnet of the API key." Works
    universally; less explicit in logs.
  - Verify either value works by running `bash infra/scripts/check-auth.sh`.

**Cloudflare** (Profile → API Tokens → Create Token → Custom token):
- Permissions:
  - Zone → DNS → Edit (on `gatheringatthegrove.com`)
  - Account → Access: Apps and Policies → Edit
- Save as `cloudflare_api_token`
- From the zone Overview page sidebar, copy the **Zone ID** and **Account ID**

### 3a. Store the tokens — pick ONE path

#### Path A: 1Password CLI (recommended)

The tokens live as a single 1Password item (`AgenticOS Infra`). Nothing on disk in plaintext; `terraform apply` reads them at runtime via `op read`.

```bash
# One-time setup
brew install --cask 1password-cli   # if not already installed
op signin                            # or biometric-unlock the app

# Create the item with placeholder fields
bash infra/scripts/setup-secrets-1password.sh

# Fill in real values — either via the 1Password app or via CLI:
op item edit "AgenticOS Infra" --vault "Goldberry Grove - Admin" \
    do_token="dop_v1_..." \
    tailscale_api_key="tskey-api-..." \
    tailscale_tailnet="goldberrygrove.farm" \
    cloudflare_api_token="..." \
    cloudflare_zone_id="..." \
    cloudflare_account_id="..."

# Verify the loader picks them up
source infra/scripts/load-secrets.sh
# Expected: "✓ Loaded AgenticOS infra secrets from 1Password (vault: Goldberry Grove - Admin)"
```

Default vault is `Goldberry Grove - Admin`. To use a different one: `export AGENTICOS_OP_VAULT="My Vault"` before running.

#### Path B: plaintext `.env` fallback

Use this only if 1Password CLI isn't an option (CI runner, fresh VM).

```bash
mkdir -p ~/.config/agenticos
cp infra/secrets.env.example ~/.config/agenticos/infra.env
chmod 600 ~/.config/agenticos/infra.env
# edit ~/.config/agenticos/infra.env with real values

# Verify the loader picks them up
source infra/scripts/load-secrets.sh
# Expected: "✓ Loaded AgenticOS infra secrets from /Users/.../.config/agenticos/infra.env"
```

The loader refuses to load this file if its permissions are not `600` or `400`.

#### Ergonomic glue: direnv (optional but nice)

```bash
brew install direnv
# Add to ~/.zshrc or ~/.bashrc: eval "$(direnv hook zsh)"  (or bash)

cd infra/terraform
direnv allow            # one-time approval
# From now on, cd-ing into infra/terraform auto-loads secrets via .envrc
```

Without direnv, you'll `source infra/scripts/load-secrets.sh` once per shell session before running `terraform`.

### 4. One-time Cloudflare prep (manual, can't be Terraformed)

Configure Google as an Identity Provider in Cloudflare Zero Trust. This is
a two-system setup (Google Cloud creates the OAuth client, Cloudflare uses it).

**4a. Find your Cloudflare team domain** (needed for the OAuth callback URL):
1. <https://dash.cloudflare.com/> → **Zero Trust** in the left sidebar
2. **Settings** (bottom of left sidebar) → **Team name and domain**
3. Your team domain is `<team-name>.cloudflareaccess.com`
4. The OAuth callback URL is `https://<team-name>.cloudflareaccess.com/cdn-cgi/access/callback`

**4b. Create a Google OAuth Client** (<https://console.cloud.google.com>):
1. Create or select a project (e.g., `AgenticOS Auth`)
2. **APIs & Services** → **OAuth consent screen**:
   - User type: **Internal** (if you have Google Workspace — recommended) or **External**
   - Fill in app name (`AgenticOS via Cloudflare`), support email, developer email
   - Default scopes are fine
3. **APIs & Services** → **Credentials** → **+ Create Credentials** → **OAuth client ID**:
   - Application type: **Web application**
   - Name: `Cloudflare Zero Trust Access`
   - Authorized redirect URIs: paste the callback URL from §4a
4. Copy the **Client ID** and **Client Secret** that pop up

**4c. Add Google IdP in Cloudflare:**
1. <https://dash.cloudflare.com/> → **Zero Trust** → **Integrations** → **Identity providers**
2. **Add new identity provider** → select **Google**
3. Fill in:
   - **Name**: `Google` (exact, capital G — the Terraform `data` block looks it up by name)
   - **App ID**: paste Google Client ID
   - **Client secret**: paste Google Client Secret
4. **Save**
5. Test via the `…` menu on the new IdP row → "Test" → sign in with `josh@goldberrygrove.farm`

Docs: <https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/>

### 5. One-time Tailscale prep (manual)

Edit your tailnet ACL (admin console → Access Controls) and ensure the `tagOwners`
block includes:

```jsonc
"tagOwners": {
  "tag:agenticos-droplet": ["autogroup:admin"]
}
```

Save. Without this, `terraform apply` will fail with `tag not allowed`.

## Apply

If you set up secrets via Path A (1Password) or Path B (`.env`), Terraform reads them from `TF_VAR_*` env vars — no `terraform.tfvars` file needed.

```bash
cd infra/terraform

# Load secrets (skip this line if direnv is set up — it loads automatically)
source ../scripts/load-secrets.sh

terraform init
terraform plan      # review
terraform apply     # ~3-5 minutes; Droplet cloud-init continues for another ~3-5 min after
```

If you'd rather use a `terraform.tfvars` file (less secure — plaintext on disk):

```bash
cp terraform.tfvars.example terraform.tfvars
chmod 600 terraform.tfvars
# edit with values
terraform apply
```

`terraform.tfvars` is gitignored so it won't accidentally land in the repo.

Watch the Droplet finish bootstrapping:

```bash
ssh -i ~/.ssh/agenticos-droplet root@$(terraform output -raw droplet_public_ip) \
  'tail -f /var/log/cloud-init-output.log'
```

When you see `AgenticOS Droplet bootstrap complete.`, you're done with the automation.

## The remaining manual step — Codex OAuth

The Droplet boots with the docker-compose stack running, but Hermes needs auth credentials
for whatever LLM provider you've configured. Terraform deliberately doesn't put credentials
into state. We default to `provider: openai-codex` — OAuth via ChatGPT account, ~$20/mo flat
subscription — because it has the best $/token at this project's usage shape.

### Codex OAuth — current default

```bash
ssh -i ~/.ssh/agenticos-droplet deploy@$(terraform output -raw droplet_public_ip)

# Confirm hermes-config/config.yaml has model.provider: openai-codex
sudo grep -A2 'model:' /opt/agenticos/hermes-config/config.yaml

# Run interactive auth — opens a device-code URL you paste into your browser
docker exec -it hermes-agent /opt/hermes/.venv/bin/hermes model

# In the menu, select "Codex" and follow the browser OAuth prompt to sign in
# with your ChatGPT Pro/Plus account.
# Hermes stores resulting credentials at ~/.hermes/auth.json. If the Codex CLI
# is already auth'd (~/.codex/auth.json exists on the Droplet), Hermes imports
# from there automatically — you may not need the interactive step at all.

# Restart so the gateway picks up the new auth
cd /opt/agenticos && docker compose restart hermes-agent hermes-gateway

# Smoke test — should print a completion
docker exec hermes-agent /opt/hermes/.venv/bin/hermes \
  --print "Reply with exactly the word 'ready'."
```

ChatGPT Pro/Plus subscription required. No API key, no per-token billing.

### Alternative — `provider: openai-api` + API key (per-token)

If you need a model the Codex provider doesn't expose (custom fine-tune, etc.), or you'd
rather pay per-token than via subscription:

```bash
# Append the API key to the env file the compose stack reads
echo 'OPENAI_API_KEY=sk-proj-...' | sudo tee -a /opt/agenticos/.env

# Switch provider in config
sudo sed -i 's/provider: "openai-codex"/provider: "openai-api"/' \
  /opt/agenticos/hermes-config/config.yaml

# Restart so the new env + provider take effect
cd /opt/agenticos && docker compose restart hermes-agent hermes-gateway
```

Key lives in 1Password under `AgenticOS Infra` → `openai_api_key` (project-scoped `sk-proj-...`).
Dashboard's Cost tab will track daily / monthly per-token burn.

### Switching to another provider entirely

Hermes supports 40+ providers — Anthropic (Claude), Gemini, OpenRouter, Grok, DeepSeek, AWS
Bedrock, Azure AI Foundry, local Ollama Cloud, and many more. Each is a `model.provider`
change in `/opt/agenticos/hermes-config/config.yaml` plus the appropriate credential and a
restart. See the [Hermes providers reference](https://hermes-agent.nousresearch.com/docs/integrations/providers)
for the full list.

## Verify

```bash
# Dashboard gate
curl -I https://agenticos.gatheringatthegrove.com
# Expected: 302 to a Cloudflare Access login page

# Browser
open https://agenticos.gatheringatthegrove.com
# Expected: Google SSO prompt → only josh@goldberrygrove.farm allowed
```

## What Terraform can NOT do (manual one-time steps)

1. **Cloudflare Google IdP setup** — prereq §4 above. OAuth credentials require interactive consent.
2. **Tailscale tagOwners ACL** — prereq §5 above. The Tailscale provider doesn't manage ACLs.
3. **Codex OAuth (or API-key fallback)** — kept out of Terraform state on purpose (subscription auth tokens and API secrets are long-running risks if persisted there). Run `hermes model` interactively post-bootstrap, or seed `OPENAI_API_KEY` into `/opt/agenticos/.env` if you've chosen the per-token path. See "The remaining manual step" above.
4. **Syncthing pairing on Mac** — needs interactive device-ID exchange.
5. **UFW rules for VPC-bound services** — the docker-compose stack binds
   Postgres (5432), OpenViking (1933), and vault-server (7779) on the
   agenticos VPC interface (`10.116.16.2`) so App Platform can reach them.
   UFW can't be set by Terraform on a running Droplet. Run once on the
   Droplet after the stack is up:
   ```bash
   sudo ufw allow from 10.116.16.0/20 to any port 5432 proto tcp comment 'Postgres from VPC'
   sudo ufw allow from 10.116.16.0/20 to any port 1933 proto tcp comment 'OpenViking from VPC'
   sudo ufw allow from 10.116.16.0/20 to any port 7779 proto tcp comment 'vault-server from VPC'
   sudo ufw status verbose | grep -E '5432|1933|7779'
   ```
   The VPC is private (`10.116.16.0/20`); these rules are defense-in-depth, not
   the only thing keeping the ports off the public internet.

(App Platform VPC attachment was previously manual but is now automated via
`digitalocean_app.spec.vpc.id` in `app-platform.tf` — DO provider 2.5x+ supports it.)

## Destroy

```bash
terraform destroy
```

⚠️ This will delete the Droplet and **its Docker volumes** (Postgres task ledger + cost rows, Ollama model cache). The vault on `/opt/vault` is also lost unless it has been Syncthing-replicated to the Mac.

Before destroying, pull the latest dump off-box (see "Backups" below), or take a fresh one on demand:

```bash
ssh deploy@$(terraform output -raw droplet_public_ip) \
  'docker compose -f /opt/agenticos/docker-compose.yml exec -T agenticos-db pg_dump -U agenticos agenticos' \
  > /tmp/agenticos-backup.sql
```

Memory itself lives in the vault as markdown, so as long as Syncthing has replicated `/opt/vault` to your Mac, the agent's accumulated knowledge survives the rebuild.

## Backups

> Full disaster-recovery plan for all three stores (vault, Postgres, OpenViking)
> — posture, procedures, restore drills — lives in
> [`docs/runbooks/backup-and-recovery.md`](../docs/runbooks/backup-and-recovery.md).
> This section covers the Postgres piece.

The Postgres cost-telemetry DB (cost rows + task/session ledger) is dumped
**automatically** by a systemd timer:

- `infra/scripts/pg-backup.sh` — `pg_dump` the `agenticos` DB from the
  `agenticos-db` container, gzip to `/opt/backups/agenticos-<UTC>.sql.gz`, then
  prune to the newest **14** dumps. A `pipefail` + minimum-size gate + atomic
  `mv` ensure a failed dump never overwrites or rotates away a good one.
- `agenticos-pg-backup.timer` fires daily at **04:00 local** (`.service` +
  `.timer` units installed via `infra/cloud-init/droplet-bootstrap.yaml.tpl`).

Fresh Droplets get the timer from cloud-init. The `.service` / `.timer` bodies
live inline in the cloud-init template (single source of truth — same pattern as
the curator units). To install on an **already-running** Droplet, copy those two
unit bodies into `/etc/systemd/system/` as root (the `deploy` user has `NOPASSWD`
for `systemctl` but not for writing unit files), then:

```bash
# 1. Refresh the repo clone so the script is present
ssh deploy@$DROPLET 'cd /opt/agenticos/repo && git pull'
# 2. As root: write agenticos-pg-backup.service + .timer to /etc/systemd/system/
#    (paste the two blocks from infra/cloud-init/droplet-bootstrap.yaml.tpl)
# 3. Enable + smoke-test
ssh deploy@$DROPLET 'sudo systemctl daemon-reload && \
  sudo systemctl enable --now agenticos-pg-backup.timer && \
  systemctl list-timers agenticos-pg-backup.timer --no-pager && \
  /opt/agenticos/repo/infra/scripts/pg-backup.sh && ls -lh /opt/backups'
```

**Scope:** this protects against volume corruption, a bad migration, or an
accidental `docker compose down -v`. It is **on-box only** — surviving total
Droplet loss requires copying `/opt/backups` off the Droplet. The $0 path
(matching the no-paid-services rule) is to add `/opt/backups` to the existing
Syncthing share so dumps replicate to the Mac alongside the vault; that needs an
interactive Syncthing folder-add (operator step) and is the natural next
increment.

**Restore:**

```bash
gunzip < agenticos-<UTC>.sql.gz | \
  ssh deploy@$DROPLET 'docker compose -f /opt/agenticos/docker-compose.yml exec -T agenticos-db psql -U agenticos agenticos'
```

## Credentials hygiene

- `terraform.tfvars` is gitignored — never commit it
- `*.tfstate` is gitignored — never commit it
- If you'll work on this from multiple machines, switch to the DO Spaces backend
  (commented block in `main.tf`) so state is shared and encrypted at rest
- Rotate API tokens at least once a year; the Tailscale auth key auto-expires after 1 hour
  (it's only needed during the first `terraform apply` for cloud-init to consume)
