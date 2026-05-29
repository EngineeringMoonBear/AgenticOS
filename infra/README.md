# AgenticOS Infrastructure (Terraform + cloud-init)

This directory provisions the AgenticOS Foundation v2 MVP infrastructure end-to-end.
After a successful `terraform apply`, one manual step remains:
SSH to the Droplet and set your OpenAI API key in `/opt/agenticos/.env`
so Hermes can reach the OpenAI Codex API for agent reasoning.

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
  - Zero Trust Tunnel `agenticos-app-platform` routing the hostname to the App Platform URL
  - Zero Trust Access application + "Allow Josh" policy gating the hostname behind Google SSO
- **Droplet (via cloud-init)**
  - Hardened SSH, UFW baseline, unattended-upgrades, fail2ban
  - Docker Engine + Compose
  - Tailscale (joined with auth key, no browser interaction)
  - Syncthing (user-service for `deploy`, GUI exposed only on `tailscale0`)
  - Node 22, pnpm 9.15.4, OpenAI Codex CLI (for headless `gpt-5-codex` invocations from Hermes skills)
  - Filesystem layout: `/opt/agenticos/repo`, `/opt/vault`, `/opt/backups`, `/etc/agenticos`
  - Repo cloned to `/opt/agenticos/repo`
  - AgenticOS docker-compose stack started (Hermes Agent + hermes-gateway + Ollama + Postgres) if `docker-compose.yml` exists in the repo
  - Cron jobs registered via `hermes cron create` (daily-brief, cost-report)

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
  - Account → Cloudflare Tunnel → Edit
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

## The remaining manual step — wire your LLM provider

The Droplet boots with the docker-compose stack running, but Hermes needs auth credentials
to reach an LLM provider. Terraform deliberately doesn't put credentials into state — set
them manually. Two options, depending on which billing model you want:

### Option A (current default) — `provider: openai` + API key (per-token)

```bash
ssh -i ~/.ssh/agenticos-droplet deploy@$(terraform output -raw droplet_public_ip)

# Append the key to the env file the compose stack reads
echo 'OPENAI_API_KEY=sk-proj-...' | sudo tee -a /opt/agenticos/.env

# Confirm hermes-config/config.yaml has model.provider: openai (default)
sudo grep -A2 'model:' /opt/agenticos/hermes-config/config.yaml

# Restart Hermes so it picks up the new env
cd /opt/agenticos && docker compose restart hermes-agent hermes-gateway

# Smoke test — should print a completion
docker exec hermes-agent /opt/hermes/.venv/bin/hermes \
  --print "Reply with exactly the word 'ready'."
```

Key lives in 1Password under `AgenticOS Infra` → `openai_api_key` (project-scoped `sk-proj-...`).
Per-token billing applies; dashboard's Cost tab tracks daily/monthly burn.

### Option B — `provider: codex` + ChatGPT Pro OAuth (flat $20/mo)

Per [Hermes docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory-providers),
`provider: codex` authenticates via ChatGPT Pro/Plus subscription rather than an API key. This is
the closest analog to "Claude Max for programmatic use" — flat subscription cost, no per-token charges.

```bash
ssh -i ~/.ssh/agenticos-droplet deploy@$(terraform output -raw droplet_public_ip)

# Switch provider in config
sudo sed -i 's/provider: "openai"/provider: "codex"/' \
  /opt/agenticos/hermes-config/config.yaml

# Run interactive auth — this opens a device-code URL you paste into your browser
docker exec -it hermes-agent /opt/hermes/.venv/bin/hermes model

# In the menu, select "Codex" and follow the browser OAuth prompt
# Verify config is signed in
docker exec hermes-agent /opt/hermes/.venv/bin/hermes config show | grep -A3 model

# Restart so the gateway picks up the new auth
cd /opt/agenticos && docker compose restart hermes-agent hermes-gateway
```

ChatGPT Pro subscription required; no API key needed; not currently the deployed configuration.

### Switching providers later

The runtime is provider-agnostic: change `model.provider` in `/opt/agenticos/hermes-config/config.yaml`
(`openai` → `codex` → `anthropic`), provide the appropriate credentials, restart. No code in this
repo needs to move.

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
3. **`OPENAI_API_KEY` in `/opt/agenticos/.env`** — kept out of Terraform state on purpose (secrets in Terraform state are a long-running risk). Set it manually post-bootstrap; see "The remaining manual step" above.
4. **Syncthing pairing on Mac** — needs interactive device-ID exchange.

(App Platform VPC attachment was previously manual but is now automated via
`digitalocean_app.spec.vpc.id` in `app-platform.tf` — DO provider 2.5x+ supports it.)

## Destroy

```bash
terraform destroy
```

⚠️ This will delete the Droplet and **its Docker volumes** (Postgres task ledger + cost rows, Ollama model cache). The vault on `/opt/vault` is also lost unless it has been Syncthing-replicated to the Mac.

Take a Postgres dump first if you want to preserve task history and cost data:

```bash
ssh deploy@$(terraform output -raw droplet_public_ip) \
  'docker compose -f /opt/agenticos/docker-compose.yml exec -T agenticos-db pg_dump -U agenticos agenticos' \
  > /tmp/agenticos-backup.sql
```

Memory itself lives in the vault as markdown, so as long as Syncthing has replicated `/opt/vault` to your Mac, the agent's accumulated knowledge survives the rebuild.

## Credentials hygiene

- `terraform.tfvars` is gitignored — never commit it
- `*.tfstate` is gitignored — never commit it
- If you'll work on this from multiple machines, switch to the DO Spaces backend
  (commented block in `main.tf`) so state is shared and encrypted at rest
- Rotate API tokens at least once a year; the Tailscale auth key auto-expires after 1 hour
  (it's only needed during the first `terraform apply` for cloud-init to consume)
