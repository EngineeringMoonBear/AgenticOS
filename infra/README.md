# AgenticOS Infrastructure (Terraform + cloud-init)

This directory provisions the AgenticOS Foundation v2 MVP infrastructure end-to-end.
After a successful `terraform apply`, exactly **one** manual step remains:
SSH to the Droplet and run `claude /login` to complete the Claude Max OAuth device-code flow.

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
  - Node 22, pnpm 9.15.4, Claude Code CLI
  - Filesystem layout: `/opt/agenticos/repo`, `/opt/vault`, `/opt/backups`, `/etc/agenticos`
  - Repo cloned to `/opt/agenticos/repo`
  - Honcho docker-compose stack started (if `docker-compose.yml` exists in the repo)
  - `agenticos-curator.timer` enabled (3:00 nightly)

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

**Tailscale** (<https://login.tailscale.com/admin/settings/keys> → Generate API key):
- Scope: `auth_keys:write`
- Note your tailnet name (the email-shaped string at the top of the admin)
- Save as `tailscale_api_key` and `tailscale_tailnet`

**Cloudflare** (Profile → API Tokens → Create Token → Custom token):
- Permissions:
  - Zone → DNS → Edit (on `gatheringatthegrove.com`)
  - Account → Access: Apps and Policies → Edit
  - Account → Cloudflare Tunnel → Edit
- Save as `cloudflare_api_token`
- From the zone Overview page sidebar, copy the **Zone ID** and **Account ID**

### 4. One-time Cloudflare prep (manual, can't be Terraformed)

Configure Google as an Identity Provider in Cloudflare Zero Trust:

1. Zero Trust dashboard → **Settings** → **Authentication** → **Login methods**
2. **Add new** → **Google** → follow the OAuth setup wizard
3. Name it exactly `Google` (the Terraform code looks it up by that name)

Docs: <https://developers.cloudflare.com/cloudflare-one/identity/idp-integration/google/>

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

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars and fill in the five token/ID values

terraform init
terraform plan      # review
terraform apply     # ~3-5 minutes; Droplet cloud-init continues for another ~3-5 min after
```

Watch the Droplet finish bootstrapping:

```bash
ssh -i ~/.ssh/agenticos-droplet root@$(terraform output -raw droplet_public_ip) \
  'tail -f /var/log/cloud-init-output.log'
```

When you see `AgenticOS Droplet bootstrap complete.`, you're done with the automation.

## The one remaining manual step

```bash
ssh -i ~/.ssh/agenticos-droplet deploy@$(terraform output -raw droplet_public_ip)
claude /login        # opens a device-code URL — paste into your browser
claude --print "hello"   # smoke test
```

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
3. **App Platform → VPC attachment** — the DO provider (v2.40.x) doesn't expose `vpc_uuid`
   on `digitalocean_app`. After apply, go to DO Console → Apps → `agenticos-dashboard` →
   Settings → VPC → select `agenticos-vpc`. Until then, App Platform reaches the Droplet
   over public IP (which is firewalled), not VPC-private.
4. **`claude /login`** — Anthropic's device-code OAuth flow requires a human.
5. **Syncthing pairing on Mac** — needs interactive device-ID exchange.

## Destroy

```bash
terraform destroy
```

⚠️ This will delete the Droplet and **its Docker volumes** (Honcho's pgvector data).
Take a `pg_dump` first if you want to preserve memory:

```bash
ssh deploy@$(terraform output -raw droplet_public_ip) \
  'docker compose -f /opt/agenticos/docker-compose.yml exec -T honcho-db pg_dump -U honcho honcho' \
  > /tmp/honcho-backup.sql
```

## Credentials hygiene

- `terraform.tfvars` is gitignored — never commit it
- `*.tfstate` is gitignored — never commit it
- If you'll work on this from multiple machines, switch to the DO Spaces backend
  (commented block in `main.tf`) so state is shared and encrypted at rest
- Rotate API tokens at least once a year; the Tailscale auth key auto-expires after 1 hour
  (it's only needed during the first `terraform apply` for cloud-init to consume)
