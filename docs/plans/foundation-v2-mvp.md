# AgenticOS Foundation v2 — MVP Implementation Plan

> **⛔ SUPERSEDED (2026-05-22):** This plan was largely replaced by Spec 1 — see
> [`docs/plans/spec1-orchestrator.md`](spec1-orchestrator.md). The agent runtime
> changed from "Claude Code + Honcho memory + homemade Node scheduler" to
> "Hermes Agent (orchestrator + cron) + OpenViking (context database, with its
> own AGFS + vector index, accessed via `viking://` URIs) + Codex CLI + local
> Ollama SLMs". **Honcho is not used.** Hermes ships a first-class OpenViking
> memory provider, so memory wiring is `hermes memory setup`, not bespoke MCP
> plumbing. Humans read knowledge through Obsidian on the Mac, against a
> markdown vault that is kept in sync with Viking (sync direction TBD — see
> Spec 1 / brainstorm notes). The infra phases (0, parts of 2, parts of 7) are
> still relevant as historical sequencing; everything that stands up Honcho,
> the Node scheduler, or the Claude-Code-only runtime is no longer the path.
> Read with that lens.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the v1 MVP of AgenticOS Foundation v2 — one nightly Curator agent running on a DigitalOcean Droplet (Claude Code + Honcho), an observability dashboard on App Platform, both deployed via GitHub Actions, all gated by Cloudflare Access + Tailscale.

**Architecture:** Cloud-first on DO. Droplet runs the agent runtime (Claude Code via Max OAuth), memory (Honcho), vault filesystem, and supporting daemons. App Platform hosts the Next.js dashboard. Mac is a client (Obsidian + browser). Three trust networks: Cloudflare Access (public), DO VPC (inter-service), Tailscale (device mesh). Spec: `docs/superpowers/specs/2026-05-20-agenticos-foundation-v2-design.md`.

**Tech Stack:** Next.js 16 · Turborepo · pnpm 9 · Vitest · Honcho (Python FastAPI, Docker) · Claude Code · PostgreSQL 16 + pgvector · Tailscale · Syncthing · Cloudflare Access · DigitalOcean (Droplet + App Platform + VPC) · GitHub Actions.

---

## Pre-flight: have these ready before starting

- DigitalOcean account with billing set up
- Cloudflare account (free) with `gatheringatthegrove.com` added as a zone (DNS managed by Cloudflare)
- Claude Max subscription, OAuth-able from the Claude CLI
- Tailscale account (free)
- GitHub repo write access (`EngineeringMoonBear/AgenticOS`)
- An SSH keypair for the Droplet (`~/.ssh/agenticos-droplet` is a good naming convention)
- ~20-30 hours over 2-3 weeks of evenings

---

## Phase 0 — Infrastructure provision (~15 min runtime + ~30 min credential setup)

Phase 0 is fully automated via Terraform. See `infra/README.md` for the full walkthrough. Summary:

1. Generate three API tokens (DigitalOcean, Tailscale, Cloudflare) — see `infra/README.md` §3
2. One-time Cloudflare (Google IdP) + Tailscale (`tagOwners` ACL) prep — see `infra/README.md` §4-5
3. `cd infra/terraform && cp terraform.tfvars.example terraform.tfvars` then edit with your tokens
4. `terraform init && terraform apply` (~3-5 min Terraform + ~3-5 min cloud-init in the background)
5. SSH to the Droplet and run `claude /login` — the one manual OAuth step Terraform can't automate

After this completes you have: VPC + Droplet + App Platform skeleton + Tailscale-joined Droplet + Cloudflare DNS + Tunnel + Access policy live; Droplet fully bootstrapped with Docker, Tailscale, Syncthing, Node 22, pnpm, Claude Code, `deploy` user, UFW configured, repo cloned to `/opt/agenticos/repo`, and (if the repo's `docker-compose.yml` exists) Honcho's stack running.

The original manual web-console steps are preserved below as a fallback for when Terraform isn't available.

### Phase 0 verification

After `terraform apply` returns:

```bash
cd infra/terraform
terraform output dashboard_public_url
curl -I "$(terraform output -raw dashboard_public_url)"
# Expected: HTTP 302 redirect to Cloudflare Access login
```

Then SSH and complete OAuth:

```bash
ssh -i ~/.ssh/agenticos-droplet deploy@$(terraform output -raw droplet_public_ip)
claude /login              # device-code OAuth in your browser
claude --print "hello"     # smoke test
```

---

<details>
<summary><strong>Fallback: manual provisioning (original Phase 0 steps)</strong></summary>

Use this fallback path only if Terraform isn't available on your workstation.

## Task 1: Create DigitalOcean VPC and SSH key

**Files:** none (DO web console)

- [ ] **Step 1: Add SSH key to DigitalOcean**

Generate locally if you don't have one:
```bash
ssh-keygen -t ed25519 -f ~/.ssh/agenticos-droplet -C "agenticos-droplet"
```

Then in DO: Settings → Security → SSH Keys → Add SSH Key. Paste `~/.ssh/agenticos-droplet.pub`. Name it `agenticos-droplet-key`.

- [ ] **Step 2: Create VPC**

DO console → Networking → VPC Network → Create VPC Network.
- Region: NYC1 (or whichever is closest)
- Name: `agenticos-vpc`
- IP range: leave default (10.108.0.0/20 or similar)

Note the IP range — you'll need it later.

- [ ] **Step 3: Verify VPC created**

DO console shows `agenticos-vpc` with status Active.

## Task 2: Provision Droplet

**Files:** none (DO web console)

- [ ] **Step 1: Create Droplet**

DO console → Droplets → Create Droplet:
- Distribution: Ubuntu 24.04 LTS
- Plan: Basic → Premium Intel → $24/mo (4GB RAM / 2 vCPU / 80GB SSD)
- Region: same as VPC (NYC1)
- VPC: select `agenticos-vpc`
- Authentication: SSH Key → `agenticos-droplet-key`
- Hostname: `agenticos-droplet`
- Tags: `agenticos`, `production`

Click Create. Wait ~30 seconds for provisioning.

- [ ] **Step 2: Note Droplet IPs**

DO shows two IPs:
- Public IPv4: e.g. `159.203.x.x`
- Private IPv4 (VPC): e.g. `10.108.0.2`

Save both to a notes file. You need the public for SSH, the private for App Platform connectivity.

- [ ] **Step 3: First SSH login**

```bash
ssh -i ~/.ssh/agenticos-droplet root@<DROPLET_PUBLIC_IP>
```

Confirm host fingerprint. You should land on `root@agenticos-droplet:~#`.

## Task 3: Bootstrap the Droplet — deploy user + hardening

**Files:** all on Droplet

- [ ] **Step 1: Update packages**

```bash
apt update && apt upgrade -y
apt install -y curl git vim ufw unattended-upgrades fail2ban
```

- [ ] **Step 2: Create `deploy` user**

```bash
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
echo "deploy ALL=(ALL) NOPASSWD: /bin/systemctl, /usr/sbin/ufw" | tee /etc/sudoers.d/deploy
mkdir -p /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
```

- [ ] **Step 3: Harden SSH**

```bash
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
```

- [ ] **Step 4: Verify deploy login from a NEW terminal (keep current SSH session open)**

```bash
ssh -i ~/.ssh/agenticos-droplet deploy@<DROPLET_PUBLIC_IP>
```

Should succeed. If it fails, fix from the open root session before disconnecting.

- [ ] **Step 5: Enable UFW with SSH open**

Back in root SSH:
```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw --force enable
ufw status
```

Expected: `Status: active`, port 22 ALLOW IN from Anywhere. Other ports we'll add later.

- [ ] **Step 6: Enable unattended security upgrades**

```bash
dpkg-reconfigure --priority=low unattended-upgrades
```

Select Yes when prompted. This auto-installs security patches.

- [ ] **Step 7: Disconnect root, reconnect as deploy**

From now on, all Droplet work happens as `deploy`. Keep root in your back pocket for break-glass.

```bash
ssh -i ~/.ssh/agenticos-droplet deploy@<DROPLET_PUBLIC_IP>
```

## Task 4: Install Tailscale on Droplet

**Files:** all on Droplet (as deploy user)

- [ ] **Step 1: Install Tailscale**

```bash
curl -fsSL https://tailscale.com/install.sh | sudo sh
```

- [ ] **Step 2: Authenticate**

```bash
sudo tailscale up --hostname=agenticos-droplet --ssh
```

The command prints a URL. Open it in your browser, log into Tailscale (create account if needed). The Droplet appears in your Tailnet.

- [ ] **Step 3: Note Tailscale IP**

```bash
tailscale ip -4
```

Outputs something like `100.x.x.x`. Note it.

- [ ] **Step 4: Verify Tailscale hostname**

From the Tailscale admin console (`https://login.tailscale.com/admin/machines`), confirm `agenticos-droplet` is listed and online. Note its FQDN, e.g., `agenticos-droplet.tailXXXX.ts.net`.

## Task 5: Install Syncthing on Droplet

**Files:** all on Droplet (as deploy user)

- [ ] **Step 1: Install via official repo**

```bash
sudo curl -o /etc/apt/keyrings/syncthing-archive-keyring.gpg https://syncthing.net/release-key.gpg
echo "deb [signed-by=/etc/apt/keyrings/syncthing-archive-keyring.gpg] https://apt.syncthing.net/ syncthing stable" | sudo tee /etc/apt/sources.list.d/syncthing.list
sudo apt update
sudo apt install -y syncthing
```

- [ ] **Step 2: Enable user-service systemd unit**

```bash
sudo systemctl enable --now syncthing@deploy.service
sudo loginctl enable-linger deploy   # allows service to run when deploy not logged in
```

- [ ] **Step 3: Verify Syncthing started**

```bash
systemctl --user status syncthing.service
```

Expected: `Active: active (running)`.

- [ ] **Step 4: Bind Syncthing GUI to Tailscale only**

```bash
sed -i 's|<address>127.0.0.1:8384</address>|<address>0.0.0.0:8384</address>|' ~/.local/state/syncthing/config.xml
systemctl --user restart syncthing.service
sudo ufw allow in on tailscale0 to any port 8384 proto tcp
```

Now you can reach `http://<droplet-tailscale-ip>:8384` from your Mac (after Mac joins Tailnet in Phase 2).

## Task 6: Install Docker on Droplet

**Files:** all on Droplet (as deploy user)

- [ ] **Step 1: Install Docker Engine**

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker deploy
```

- [ ] **Step 2: Re-login to pick up docker group**

Disconnect SSH and reconnect. Then verify:

```bash
docker run --rm hello-world
```

Expected: "Hello from Docker!" message.

- [ ] **Step 3: Install Docker Compose plugin**

```bash
docker compose version
```

Expected: `Docker Compose version v2.x.x`. (Comes bundled with `get.docker.com`.)

## Task 7: Install Claude Code on Droplet

**Files:** all on Droplet (as deploy user)

- [ ] **Step 1: Install Node 22 via nvm**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22
nvm alias default 22
node --version    # expect v22.x.x
```

- [ ] **Step 2: Install Claude Code globally**

```bash
npm install -g @anthropic-ai/claude-code
claude --version
```

Expected: version string printed.

- [ ] **Step 3: OAuth with Claude Max via device-code flow**

```bash
claude /login
```

Output prints a URL with a device code. Open it on your Mac browser, authenticate with the Max-subscribed Anthropic account. Once approved, the Droplet's Claude Code is authenticated.

- [ ] **Step 4: Verify with a small prompt**

```bash
claude --print "Say hello and tell me you are running on the AgenticOS droplet"
```

Expected: a coherent response from Claude (typically Sonnet 4.7 by default).

- [ ] **Step 5: Install pnpm globally**

```bash
npm install -g pnpm@9.15.4
pnpm --version    # expect 9.15.4
```

## Task 8: Cloudflare DNS for `agenticos.gatheringatthegrove.com`

**Files:** none (Cloudflare web console)

- [ ] **Step 1: Verify zone exists**

Cloudflare dashboard → confirm `gatheringatthegrove.com` is in the account, status Active, nameservers pointing to Cloudflare.

- [ ] **Step 2: Add placeholder A record**

DNS → Add record:
- Type: A
- Name: `agenticos`
- IPv4: `192.0.2.1` (placeholder; will be replaced by Cloudflare Tunnel later — Cloudflare won't actually route to this)
- Proxy status: Proxied (orange cloud)
- TTL: Auto

Save.

- [ ] **Step 3: Verify**

```bash
dig +short agenticos.gatheringatthegrove.com
```

Expected: a Cloudflare-owned IP (NOT 192.0.2.1, since Cloudflare proxies).

## Task 9: App Platform skeleton

**Files:** repo root will get an `app.yaml` later; for now use UI

- [ ] **Step 1: Create App Platform app**

DO console → Apps → Create App.
- Source: GitHub → connect → select `EngineeringMoonBear/AgenticOS`
- Branch: `main`
- Autodeploy: ON
- Source directory: `/apps/dashboard`
- Type: Web Service
- Build command: `cd ../.. && pnpm install --frozen-lockfile && pnpm --filter @agenticos/dashboard build`
- Run command: `cd ../.. && pnpm --filter @agenticos/dashboard start`
- HTTP port: 3000
- Plan: Basic (`$5/mo, 512 MB / 1 vCPU)`
- VPC: select `agenticos-vpc` ← critical
- App name: `agenticos-dashboard`

Create. First deploy will likely fail because the dashboard expects env vars + the routes are still Hermes-shaped. That's fine for now; we're just establishing the skeleton.

- [ ] **Step 2: Note App Platform default URL**

DO shows the live URL, e.g. `https://agenticos-dashboard-abc123.ondigitalocean.app`. Save it.

- [ ] **Step 3: Add environment variables placeholder**

Apps → agenticos-dashboard → Settings → App-Level Environment Variables. Add (for now, placeholders we'll fill later):
- `HONCHO_URL=http://10.108.0.2:8000` (use the Droplet's VPC private IP)
- `NODE_ENV=production`

Save. App will redeploy automatically.

## Task 10: Cloudflare Tunnel + Access policy

**Files:** all on Cloudflare web console + Droplet

- [ ] **Step 1: Create Cloudflare Tunnel**

Cloudflare Zero Trust dashboard → Networks → Tunnels → Create a tunnel.
- Connector: Cloudflared
- Name: `agenticos-app-platform`
- Save

Cloudflare shows install commands for various platforms. We don't actually run cloudflared on the Droplet for this tunnel — we use it to wrap the App Platform URL directly. Continue to next page.

- [ ] **Step 2: Public Hostname**

Add a public hostname to the tunnel:
- Subdomain: `agenticos`
- Domain: `gatheringatthegrove.com`
- Path: (empty)
- Service: Type `HTTPS`, URL `agenticos-dashboard-abc123.ondigitalocean.app` (the App Platform URL from Task 9, without `https://`)
- Origin Server Name → Additional application settings → HTTP Settings → HTTP Host Header: same App Platform hostname

Save. The DNS A record from Task 8 now gets replaced by a CNAME-like routing via Cloudflare.

- [ ] **Step 3: Create Access Application**

Zero Trust dashboard → Access → Applications → Add an application → Self-hosted.
- Application name: `AgenticOS Dashboard`
- Session duration: 24 hours
- Application domain: `agenticos.gatheringatthegrove.com`
- Identity providers: Google (or add Google as IdP first if not present)

Save.

- [ ] **Step 4: Create Access Policy**

Inside the application, add a policy:
- Policy name: `Allow Josh`
- Action: Allow
- Include: Emails → `josh@goldberrygrove.farm`

Save.

- [ ] **Step 5: Test the gate**

Open `https://agenticos.gatheringatthegrove.com` in incognito. Expected: Cloudflare Access Google sign-in page. Sign in with <josh@goldberrygrove.farm>. You land on the App Platform dashboard (which may render an error because routes aren't wired yet — that's OK; we're testing the auth gate).

- [ ] **Step 6: Test denial**

Open the same URL in a different incognito with a non-allowed Google account. Expected: Access denial page.

## Task 11: Verify end-to-end networking

**Files:** none (verification only)

- [ ] **Step 1: From your Mac (not yet on Tailnet), verify dashboard auth gate**

```bash
curl -I https://agenticos.gatheringatthegrove.com
```

Expected: HTTP 302 redirect to Cloudflare Access login page.

- [ ] **Step 2: From Droplet, verify App Platform unreachable on public internet**

```bash
ssh -i ~/.ssh/agenticos-droplet deploy@<DROPLET_PUBLIC_IP> 'curl -I https://agenticos-dashboard-abc123.ondigitalocean.app'
```

Expected: HTTP 200 or 308 from App Platform directly (this is fine — App Platform URL itself is public, the auth is on the custom domain).

- [ ] **Step 3: Commit Phase 0 notes**

Create a runbook for future-you. On your Mac, in the repo:

```bash
cd ~/Documents/Dev\ Projects/AgenticOS
cat > docs/runbooks/infrastructure.md << 'EOF'
# Infrastructure Runbook (filled out during Phase 0 of foundation v2 MVP)

## Droplet
- Hostname: agenticos-droplet
- Public IPv4: <FILL IN>
- VPC private IPv4: <FILL IN>
- Tailscale IP: <FILL IN>
- Tailscale FQDN: agenticos-droplet.tailXXXX.ts.net
- SSH: ssh -i ~/.ssh/agenticos-droplet deploy@<public-ip>

## App Platform
- App name: agenticos-dashboard
- Default URL: <FILL IN>
- Custom domain: agenticos.gatheringatthegrove.com
- VPC: agenticos-vpc

## Cloudflare
- Zone: gatheringatthegrove.com
- Access App: AgenticOS Dashboard
- Access policy: Allow josh@goldberrygrove.farm

## Recovery
If Droplet dies: terraform up (NOT YET BUILT), restore pg_dump + Syncthing rejoin, re-OAuth Claude Code, App Platform unaffected.
EOF
mkdir -p docs/runbooks
mv docs/runbooks/infrastructure.md docs/runbooks/infrastructure.md   # noop, just create folder
# (you'll fill in IPs by editing the file)
```

```bash
git add docs/runbooks/infrastructure.md
git commit -m "docs(runbook): infrastructure provisioning notes from Phase 0"
```

</details>

---

## Phase 1 — Honcho + Claude Code OAuth (~2 hr)

> **Note:** With the Terraform path from Phase 0, most of this phase is already done. The Droplet has Docker + Claude Code installed, the repo is cloned to `/opt/agenticos/repo`, and (if `docker-compose.yml` exists in the repo) the Honcho stack is already running. After `claude /login` you should be able to:
>
> ```bash
> curl http://127.0.0.1:8000/health   # Honcho REST API
> claude --print "hello"               # Claude Code OAuth smoke test
> ```
>
> If those work, skip ahead to Phase 1 verification (Task 13) and Phase 2.

## Task 12: Honcho docker-compose

**Files:**
- Create: `/opt/agenticos/docker-compose.yml` (on Droplet)
- Create: `/opt/agenticos/.env` (on Droplet)

- [ ] **Step 1: Create app directory on Droplet**

```bash
sudo mkdir -p /opt/agenticos /opt/vault /opt/backups
sudo chown -R deploy:deploy /opt/agenticos /opt/vault /opt/backups
cd /opt/agenticos
```

- [ ] **Step 2: Write docker-compose.yml**

```bash
cat > /opt/agenticos/docker-compose.yml << 'EOF'
services:
  honcho-db:
    image: pgvector/pgvector:pg16
    restart: unless-stopped
    environment:
      POSTGRES_USER: honcho
      POSTGRES_PASSWORD: ${HONCHO_DB_PASSWORD}
      POSTGRES_DB: honcho
    volumes:
      - honcho-db-data:/var/lib/postgresql/data
    networks:
      - agenticos
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "honcho"]
      interval: 5s
      timeout: 5s
      retries: 10

  honcho:
    image: plasticlabs/honcho:latest
    restart: unless-stopped
    depends_on:
      honcho-db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://honcho:${HONCHO_DB_PASSWORD}@honcho-db:5432/honcho
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY_OR_BLANK}
    ports:
      - "127.0.0.1:8000:8000"
      - "10.108.0.2:8000:8000"  # replace with this Droplet's VPC private IP
    networks:
      - agenticos

volumes:
  honcho-db-data:

networks:
  agenticos:
    driver: bridge
EOF
```

Edit `10.108.0.2:8000:8000` to use your actual Droplet VPC private IP (from Task 2).

- [ ] **Step 3: Write .env**

```bash
cat > /opt/agenticos/.env << EOF
HONCHO_DB_PASSWORD=$(openssl rand -hex 32)
ANTHROPIC_API_KEY_OR_BLANK=
EOF
chmod 600 /opt/agenticos/.env
```

Note: Honcho's background reasoning loop will use Claude Code-mediated calls in v1 (no Anthropic API key needed). The env var is set blank; Honcho's image accepts that.

- [ ] **Step 4: Open ports in UFW**

```bash
sudo ufw allow in on tailscale0 to any port 8000 proto tcp comment 'honcho via tailscale'
# Note: VPC private port doesn't need ufw rule — DO firewall handles VPC routing
```

- [ ] **Step 5: Start Honcho**

```bash
cd /opt/agenticos
docker compose up -d
docker compose ps
```

Expected: both `honcho-db` and `honcho` show status "Up" and "healthy" (within 30 seconds).

## Task 13: Verify Honcho REST API

**Files:** none

- [ ] **Step 1: Health check from Droplet loopback**

```bash
curl -s http://127.0.0.1:8000/health
```

Expected: `{"status":"ok"}` or similar 200 response.

- [ ] **Step 2: Verify from VPC private IP**

```bash
curl -s http://<droplet-vpc-private-ip>:8000/health
```

Expected: same response. This is what App Platform will hit.

- [ ] **Step 3: Create a test workspace**

```bash
curl -s -X POST http://127.0.0.1:8000/v1/workspaces \
  -H "Content-Type: application/json" \
  -d '{"id": "agenticos-test"}' | jq
```

Expected: JSON response with workspace id `agenticos-test`.

## Task 14: Probe Honcho MCP tools

**Files:** none

- [ ] **Step 1: Honcho exposes MCP at `/mcp`. Probe via Claude Code on the Droplet**

```bash
cat > /tmp/honcho-mcp-test.json << 'EOF'
{
  "mcpServers": {
    "honcho": {
      "type": "http",
      "url": "http://127.0.0.1:8000/mcp"
    }
  }
}
EOF
claude --print "List the tools available to you" --mcp-config /tmp/honcho-mcp-test.json
```

- [ ] **Step 2: Record the tool surface**

Capture the output — it lists Honcho's MCP tools. Expected names likely include something like `honcho_create_session`, `honcho_get_peer_representation`, `honcho_add_message`, `honcho_search`. **Save this list** — Task 38 (`run-curator.sh`) needs to know which tool names are real.

If the tool names materially differ from the spec's contract in §14 Q1, raise as a blocker. (Spec says: peer rep retrieval, add_message with metadata, search.)

## Task 15: Verify Claude Code OAuth still healthy

**Files:** none

- [ ] **Step 1: Run a quick test**

```bash
claude --print "What is 2+2? Reply with only the number."
```

Expected: `4` (or `4.`).

If OAuth has expired (rare in first ~30 days), re-run `claude /login`.

- [ ] **Step 2: Test stream-json output format**

```bash
claude --print "List three colors" --output-format=stream-json
```

Expected: line-delimited JSON output, each line with a `type` field. We'll parse this in Phase 5.

## Task 16: Commit Phase 1 outputs

**Files:**
- Modify: `docs/runbooks/infrastructure.md` (locally on Mac)

- [ ] **Step 1: Add Honcho details to runbook**

On Mac, edit `docs/runbooks/infrastructure.md` and add a "Phase 1" section:

```markdown
## Honcho

- Container: `plasticlabs/honcho:latest`
- DB: `pgvector/pgvector:pg16`
- Bind: `127.0.0.1:8000` (loopback) + `<vpc-private-ip>:8000` (VPC)
- DB password: stored in `/opt/agenticos/.env` (NOT in git)
- MCP endpoint: `http://127.0.0.1:8000/mcp`
- Volume: `honcho-db-data` (Docker named volume)

## Claude Code

- Authenticated via Max OAuth (Claude /login device-code flow)
- Token location: `~/.claude/` on Droplet
- Default model: `claude-sonnet-4-7` (Anthropic's current default)
- Test: `claude --print "test"`
```

```bash
git add docs/runbooks/infrastructure.md
git commit -m "docs(runbook): Phase 1 Honcho + Claude Code details"
```

---

## Phase 2 — Vault sync working (~1 hr)

> **Note:** With the Terraform path from Phase 0, the Droplet side is already done: Syncthing is installed, running as the `deploy` user, GUI bound to `tailscale0` on port 8384, and `/opt/vault` exists with `deploy` ownership. You only need to do the Mac side (Tasks 18-20).

## Task 17: Move vault content to Droplet `/opt/vault`

**Files:** all vault content

- [ ] **Step 1: From Mac, package the vault**

```bash
cd ~/Documents/Dev\ Projects/
tar -czf /tmp/vault-bootstrap.tar.gz vault/
ls -la /tmp/vault-bootstrap.tar.gz
```

- [ ] **Step 2: Copy to Droplet**

```bash
scp -i ~/.ssh/agenticos-droplet /tmp/vault-bootstrap.tar.gz deploy@<DROPLET_PUBLIC_IP>:/tmp/
```

- [ ] **Step 3: Extract on Droplet**

```bash
ssh -i ~/.ssh/agenticos-droplet deploy@<DROPLET_PUBLIC_IP>
cd /opt
tar -xzf /tmp/vault-bootstrap.tar.gz
ls -la /opt/vault | head -10
```

Expected: vault contents in `/opt/vault/`. Confirm `wiki/`, `inbox/`, `sources/` directories present.

- [ ] **Step 4: Clean up local Mac vault tarball**

```bash
# On Mac
rm /tmp/vault-bootstrap.tar.gz
```

## Task 18: Install Tailscale on Mac

**Files:** none

- [ ] **Step 1: Install via Homebrew**

```bash
brew install --cask tailscale
open -a Tailscale
```

The Tailscale menu bar icon appears.

- [ ] **Step 2: Log in (same account as Droplet)**

Click the menu bar icon → Log in. Authenticate via browser. Your Mac appears in the Tailnet.

- [ ] **Step 3: Verify connectivity to Droplet**

```bash
tailscale ping <DROPLET_TAILSCALE_HOSTNAME>
ssh deploy@<DROPLET_TAILSCALE_HOSTNAME>  # using Tailscale hostname now
```

Expected: ping latency reported; SSH succeeds. From here on, prefer the Tailscale hostname over public IPs.

## Task 19: Install Syncthing on Mac

**Files:** none (Syncthing app + GUI)

- [ ] **Step 1: Install via Homebrew**

```bash
brew install --cask syncthing
open -a Syncthing
```

Syncthing GUI opens at `http://localhost:8384`.

- [ ] **Step 2: Note Mac Syncthing device ID**

In Syncthing GUI: Actions → Show ID → copy the long device ID string (looks like `XXXX-XXXX-XXXX-...`).

## Task 20: Pair devices and start sync

**Files:** none

- [ ] **Step 1: From Mac, open Droplet's Syncthing GUI via Tailscale**

```bash
open http://<DROPLET_TAILSCALE_IP>:8384
```

Authenticate (no auth by default for fresh Syncthing; if prompted, set a GUI password in Actions → Settings → GUI).

- [ ] **Step 2: Add Mac as a device on Droplet's Syncthing**

In Droplet's Syncthing GUI:
- Click "Add Remote Device"
- Paste Mac's device ID
- Name: `josh-mac`
- Save

Droplet sends a pairing request to Mac.

- [ ] **Step 3: Accept pairing on Mac**

Mac Syncthing GUI shows a popup: "New Device 'agenticos-droplet'." Click Add.
- Auto Accept: ON (so future folders sync without manual approval)
- Save

- [ ] **Step 4: Share vault folder from Droplet → Mac**

On Droplet Syncthing GUI:
- Click "Add Folder"
- Folder label: `vault`
- Folder ID: `agenticos-vault`
- Folder path: `/opt/vault`
- Sharing tab → check `josh-mac`
- File Versioning: Staggered File Versioning, max age 30 days
- Save

- [ ] **Step 5: Accept share on Mac**

Mac Syncthing GUI shows a popup: "Add Folder 'agenticos-vault'."
- Folder path: `~/Documents/Dev Projects/vault` (your existing local path — Syncthing will merge)
- Save

⚠️ **IMPORTANT:** Mac's existing vault dir might conflict with the incoming Droplet copy. Since we copied Mac→Droplet first in Task 17, contents should be identical. Syncthing will hash-compare; conflicts go to `.sync-conflict-*` files. If you see conflicts, inspect manually.

- [ ] **Step 6: Verify bidirectional sync**

```bash
# On Mac
echo "test from Mac $(date)" > ~/Documents/Dev\ Projects/vault/_sync-test.md
sleep 5
# On Droplet
cat /opt/vault/_sync-test.md
```

Expected: the file from Mac appears on Droplet.

```bash
# On Droplet
echo "reply from droplet" >> /opt/vault/_sync-test.md
sleep 5
# On Mac
cat ~/Documents/Dev\ Projects/vault/_sync-test.md
```

Expected: both lines visible. Sync works.

- [ ] **Step 7: Clean up test file**

```bash
rm ~/Documents/Dev\ Projects/vault/_sync-test.md
```

After ~5s, Droplet's copy disappears too.

---

## Phase 3 — AgenticOS code refactor (~6 hr)

## Task 21: Clean up macOS Finder duplicates and add `.claude/` to .gitignore

**Files:**
- Modify: `.gitignore`
- Delete: all `* 2.{md,ts,tsx,etc}` files in the repo

- [ ] **Step 1: From Mac, list the duplicates**

```bash
cd ~/Documents/Dev\ Projects/AgenticOS
find . -name "* 2.*" -not -path './node_modules/*' -not -path './.git/*' | head -30
```

Expected: ~10-15 files matching the pattern.

- [ ] **Step 2: Diff each against its non-duplicate sibling (optional but safe)**

```bash
for f in $(find . -name "* 2.*" -not -path './node_modules/*' -not -path './.git/*'); do
  original="${f// 2./.}"
  if [ -f "$original" ]; then
    if ! diff -q "$f" "$original" > /dev/null; then
      echo "DIFFERS: $f"
    fi
  fi
done
```

Expected: no output (i.e., duplicates are identical to originals). If you see "DIFFERS," inspect manually before deletion.

- [ ] **Step 3: Delete duplicates**

```bash
find . -name "* 2.*" -not -path './node_modules/*' -not -path './.git/*' -delete
git status --short | head -10
```

- [ ] **Step 4: Add `.claude/` to .gitignore**

```bash
echo "" >> .gitignore
echo "# Claude Code local state" >> .gitignore
echo ".claude/" >> .gitignore
```

- [ ] **Step 5: Commit**

```bash
git add .gitignore
git rm $(git ls-files | grep " 2\." | tr '\n' ' ') 2>/dev/null || true
git commit -m "chore: remove macOS Finder duplicates, ignore .claude/"
```

## Task 22: Delete `packages/hermes-client/`

**Files:**
- Delete: `packages/hermes-client/` (entire directory)
- Modify: `apps/dashboard/package.json` (remove workspace dep)

- [ ] **Step 1: Delete the package**

```bash
cd ~/Documents/Dev\ Projects/AgenticOS
git rm -r packages/hermes-client/
```

- [ ] **Step 2: Remove the workspace dep from dashboard**

Edit `apps/dashboard/package.json`. Find and delete this line:
```json
    "@agenticos/hermes-client": "workspace:*",
```

Also delete `"eventsource-parser": "^3.0.0",` since Honcho SDK handles SSE for us.

- [ ] **Step 3: Update lockfile**

```bash
pnpm install
```

- [ ] **Step 4: Verify build still works (will have errors from hermes imports — that's expected next task)**

```bash
pnpm --filter @agenticos/dashboard typecheck 2>&1 | head -20
```

Expected: errors about missing `@agenticos/hermes-client`. We'll fix in Task 23+.

- [ ] **Step 5: Commit**

```bash
git add packages/hermes-client apps/dashboard/package.json pnpm-lock.yaml
git commit -m "chore: delete packages/hermes-client (superseded by composed stack)"
```

## Task 23: Add Honcho TypeScript SDK and remove broken imports

**Files:**
- Modify: `apps/dashboard/package.json`

- [ ] **Step 1: Add Honcho SDK**

```bash
cd ~/Documents/Dev\ Projects/AgenticOS
pnpm --filter @agenticos/dashboard add honcho-ai
```

(Honcho's npm package is `honcho-ai`. If install fails, check `npm view honcho-ai` for the actual package name.)

- [ ] **Step 2: Verify install**

```bash
grep honcho apps/dashboard/package.json
```

Expected: `"honcho-ai": "^x.x.x"`.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/package.json pnpm-lock.yaml
git commit -m "deps: add honcho-ai TypeScript SDK"
```

## Task 24: Create `apps/dashboard/lib/agent/types.ts`

**Files:**
- Create: `apps/dashboard/lib/agent/types.ts`

- [ ] **Step 1: Create the types file**

```bash
mkdir -p apps/dashboard/lib/agent
cat > apps/dashboard/lib/agent/types.ts << 'EOF'
import { z } from "zod";

export const RunStatus = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "budget_exceeded",
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const RunRecord = z.object({
  id: z.string(),
  agent: z.string(),
  status: RunStatus,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  costUsd: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheCreationTokens: z.number(),
  toolCalls: z.number(),
  errorMessage: z.string().nullable(),
});
export type RunRecord = z.infer<typeof RunRecord>;

export const StreamJsonEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("system"),
    subtype: z.string().optional(),
    session_id: z.string().optional(),
    model: z.string().optional(),
  }),
  z.object({
    type: z.literal("assistant"),
    message: z.object({
      content: z.array(z.unknown()),
      usage: z.object({
        input_tokens: z.number(),
        output_tokens: z.number(),
        cache_read_input_tokens: z.number().optional(),
        cache_creation_input_tokens: z.number().optional(),
      }).optional(),
    }),
  }),
  z.object({
    type: z.literal("user"),
    message: z.object({ content: z.array(z.unknown()) }),
  }),
  z.object({
    type: z.literal("result"),
    subtype: z.string(),
    total_cost_usd: z.number().optional(),
    duration_ms: z.number().optional(),
    is_error: z.boolean().optional(),
  }),
]);
export type StreamJsonEvent = z.infer<typeof StreamJsonEvent>;
EOF
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm --filter @agenticos/dashboard typecheck 2>&1 | grep "lib/agent" || echo "no errors in lib/agent"
```

Expected: no errors in lib/agent/types.ts.

## Task 25: Create `apps/dashboard/lib/agent/honcho-client.ts`

**Files:**
- Create: `apps/dashboard/lib/agent/honcho-client.ts`
- Create: `apps/dashboard/lib/agent/honcho-client.test.ts`

- [ ] **Step 1: Write the failing test first**

```bash
cat > apps/dashboard/lib/agent/honcho-client.test.ts << 'EOF'
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock 'server-only' so import works in test
vi.mock("server-only", () => ({}));

import { getHonchoClient, resetHonchoClientForTests } from "./honcho-client";

describe("honcho-client", () => {
  beforeEach(() => {
    resetHonchoClientForTests();
    process.env.HONCHO_URL = "http://localhost:8000";
  });

  it("returns a singleton client", () => {
    const a = getHonchoClient();
    const b = getHonchoClient();
    expect(a).toBe(b);
  });

  it("uses HONCHO_URL env var as base URL", () => {
    process.env.HONCHO_URL = "http://example:8000";
    resetHonchoClientForTests();
    const client = getHonchoClient();
    // The Honcho SDK exposes baseURL on the client; assert it
    // (Adjust property access if the SDK names it differently.)
    expect((client as any).baseURL ?? (client as any).options?.baseURL).toMatch(/example:8000/);
  });

  it("throws if HONCHO_URL is missing", () => {
    delete process.env.HONCHO_URL;
    resetHonchoClientForTests();
    expect(() => getHonchoClient()).toThrow(/HONCHO_URL/);
  });
});
EOF
```

- [ ] **Step 2: Run the test (expect failure)**

```bash
pnpm --filter @agenticos/dashboard test -- honcho-client.test
```

Expected: test fails because `honcho-client.ts` doesn't exist.

- [ ] **Step 3: Write minimal implementation**

```bash
cat > apps/dashboard/lib/agent/honcho-client.ts << 'EOF'
import "server-only";
import { Honcho } from "honcho-ai";

let cached: Honcho | null = null;

export function getHonchoClient(): Honcho {
  if (cached) return cached;
  const baseURL = process.env.HONCHO_URL;
  if (!baseURL) {
    throw new Error("HONCHO_URL environment variable is required");
  }
  cached = new Honcho({
    baseURL,
    workspaceId: process.env.HONCHO_WORKSPACE_ID ?? "agenticos",
  });
  return cached;
}

export function resetHonchoClientForTests(): void {
  cached = null;
}
EOF
```

- [ ] **Step 4: Run tests (expect pass)**

```bash
pnpm --filter @agenticos/dashboard test -- honcho-client.test
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/lib/agent/
git commit -m "feat(agent): Honcho client singleton with tests"
```

## Task 26: Create `apps/dashboard/lib/agent/spawn.ts` (Claude Code subprocess + stream-json parser)

**Files:**
- Create: `apps/dashboard/lib/agent/spawn.ts`
- Create: `apps/dashboard/lib/agent/spawn.test.ts`

- [ ] **Step 1: Write the failing test**

```bash
cat > apps/dashboard/lib/agent/spawn.test.ts << 'EOF'
import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseStreamJson, type ParsedRun } from "./spawn";

describe("parseStreamJson", () => {
  it("accumulates input/output tokens across assistant events", () => {
    const lines = [
      JSON.stringify({ type: "system", session_id: "s1", model: "claude-sonnet-4-7" }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [],
          usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [],
          usage: { input_tokens: 30, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
      }),
      JSON.stringify({ type: "result", subtype: "success", total_cost_usd: 0.003, duration_ms: 5000, is_error: false }),
    ];
    const result: ParsedRun = parseStreamJson(lines);
    expect(result.inputTokens).toBe(130);
    expect(result.outputTokens).toBe(70);
    expect(result.costUsd).toBe(0.003);
    expect(result.isError).toBe(false);
    expect(result.sessionId).toBe("s1");
  });

  it("flags errors when result.is_error is true", () => {
    const lines = [
      JSON.stringify({ type: "system", session_id: "s2" }),
      JSON.stringify({ type: "result", subtype: "error", is_error: true }),
    ];
    const result = parseStreamJson(lines);
    expect(result.isError).toBe(true);
  });

  it("ignores malformed JSON lines without crashing", () => {
    const lines = [
      "{not valid json}",
      JSON.stringify({ type: "result", subtype: "success", total_cost_usd: 0.001 }),
    ];
    const result = parseStreamJson(lines);
    expect(result.costUsd).toBe(0.001);
  });
});
EOF
```

- [ ] **Step 2: Run the test (expect failure)**

```bash
pnpm --filter @agenticos/dashboard test -- spawn.test
```

Expected: failure — `parseStreamJson` not defined.

- [ ] **Step 3: Write implementation**

```bash
cat > apps/dashboard/lib/agent/spawn.ts << 'EOF'
import "server-only";
import { spawn } from "node:child_process";
import { StreamJsonEvent } from "./types";

export interface ParsedRun {
  sessionId: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  durationMs: number;
  isError: boolean;
  toolCalls: number;
}

export function parseStreamJson(lines: string[]): ParsedRun {
  const result: ParsedRun = {
    sessionId: null,
    model: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
    durationMs: 0,
    isError: false,
    toolCalls: 0,
  };

  for (const raw of lines) {
    if (!raw.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const validation = StreamJsonEvent.safeParse(parsed);
    if (!validation.success) continue;
    const event = validation.data;

    switch (event.type) {
      case "system":
        result.sessionId = event.session_id ?? result.sessionId;
        result.model = event.model ?? result.model;
        break;
      case "assistant":
        if (event.message.usage) {
          result.inputTokens += event.message.usage.input_tokens;
          result.outputTokens += event.message.usage.output_tokens;
          result.cacheReadTokens += event.message.usage.cache_read_input_tokens ?? 0;
          result.cacheCreationTokens += event.message.usage.cache_creation_input_tokens ?? 0;
        }
        if (Array.isArray(event.message.content)) {
          for (const block of event.message.content as Array<{ type?: string }>) {
            if (block.type === "tool_use") result.toolCalls += 1;
          }
        }
        break;
      case "result":
        result.costUsd = event.total_cost_usd ?? 0;
        result.durationMs = event.duration_ms ?? 0;
        result.isError = event.is_error ?? false;
        break;
    }
  }

  return result;
}

export interface SpawnClaudeOptions {
  prompt: string;
  mcpConfigPath?: string;
  systemPromptPath?: string;
  cwd?: string;
  timeoutMs?: number;
}

export async function spawnClaude(options: SpawnClaudeOptions): Promise<{
  parsed: ParsedRun;
  stderr: string;
  exitCode: number;
}> {
  const args = [
    "--print",
    options.prompt,
    "--output-format=stream-json",
    "--verbose",
  ];
  if (options.mcpConfigPath) args.push("--mcp-config", options.mcpConfigPath);
  if (options.systemPromptPath) args.push("--append-system-prompt-from", options.systemPromptPath);

  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd: options.cwd,
      env: process.env,
    });

    const stdoutLines: string[] = [];
    let stdoutBuffer = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdoutBuffer += data.toString("utf-8");
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      stdoutLines.push(...lines);
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString("utf-8");
    });

    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error(`Claude Code timed out after ${options.timeoutMs}ms`));
        }, options.timeoutMs)
      : null;

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (stdoutBuffer.trim()) stdoutLines.push(stdoutBuffer);
      const parsed = parseStreamJson(stdoutLines);
      resolve({ parsed, stderr, exitCode: code ?? 0 });
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}
EOF
```

- [ ] **Step 4: Run tests (expect pass)**

```bash
pnpm --filter @agenticos/dashboard test -- spawn.test
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/lib/agent/spawn.ts apps/dashboard/lib/agent/spawn.test.ts
git commit -m "feat(agent): spawn Claude Code + parse stream-json output"
```

## Task 27: Create `apps/dashboard/lib/agent/index.ts` (barrel export)

**Files:**
- Create: `apps/dashboard/lib/agent/index.ts`

- [ ] **Step 1: Write the barrel**

```bash
cat > apps/dashboard/lib/agent/index.ts << 'EOF'
export { getHonchoClient, resetHonchoClientForTests } from "./honcho-client";
export { spawnClaude, parseStreamJson } from "./spawn";
export type { ParsedRun, SpawnClaudeOptions } from "./spawn";
export { RunStatus, RunRecord, StreamJsonEvent } from "./types";
export type { RunStatus as RunStatusType, RunRecord as RunRecordType, StreamJsonEvent as StreamJsonEventType } from "./types";
EOF
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm --filter @agenticos/dashboard typecheck 2>&1 | grep "lib/agent" || echo "agent module clean"
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/lib/agent/index.ts
git commit -m "feat(agent): barrel exports"
```

## Task 28: Delete `apps/dashboard/lib/hermes/` and update `instrumentation.ts`

**Files:**
- Delete: `apps/dashboard/lib/hermes/`
- Modify: `apps/dashboard/instrumentation.ts`

- [ ] **Step 1: Delete the hermes lib dir**

```bash
git rm -r apps/dashboard/lib/hermes/
```

- [ ] **Step 2: Check what imports it**

```bash
grep -rn "from.*lib/hermes" apps/dashboard --include="*.ts" --include="*.tsx" | head -20
```

If anything still imports `lib/hermes`, fix imports to point at `lib/agent` instead.

- [ ] **Step 3: Update instrumentation.ts**

`apps/dashboard/instrumentation.ts` doesn't reference hermes currently (only scheduler + mcp-vault). Verify it's unchanged:

```bash
cat apps/dashboard/instrumentation.ts
```

If it references the old client-singleton, edit it to remove the reference.

- [ ] **Step 4: Run typecheck**

```bash
pnpm --filter @agenticos/dashboard typecheck 2>&1 | tail -30
```

Note errors that mention `hermes-client` or `lib/hermes` — they need cleanup in Tasks 29-31.

- [ ] **Step 5: Commit (even if typecheck still has errors elsewhere)**

```bash
git add apps/dashboard/
git commit -m "chore(agent): remove lib/hermes/ (replaced by lib/agent/)"
```

## Task 29: Replace `app/api/hermes/health` → `app/api/agent/health`

**Files:**
- Create: `apps/dashboard/app/api/agent/health/route.ts`
- Delete: `apps/dashboard/app/api/hermes/health/`

- [ ] **Step 1: Create the new health route**

```bash
mkdir -p apps/dashboard/app/api/agent/health
cat > apps/dashboard/app/api/agent/health/route.ts << 'EOF'
import { NextResponse } from "next/server";
import { getHonchoClient } from "@/lib/agent";

export const dynamic = "force-dynamic";

export async function GET() {
  const start = Date.now();
  try {
    const honcho = getHonchoClient();
    // Honcho SDK provides health check via workspace list (lightweight)
    await honcho.workspaces.list({ limit: 1 });
    return NextResponse.json({
      status: "ok",
      honcho: { reachable: true, latencyMs: Date.now() - start },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      {
        status: "degraded",
        honcho: { reachable: false, error: message, latencyMs: Date.now() - start },
      },
      { status: 503 },
    );
  }
}
EOF
```

- [ ] **Step 2: Delete old hermes/health**

```bash
git rm -r apps/dashboard/app/api/hermes/health/
```

- [ ] **Step 3: Verify route works at build time**

```bash
pnpm --filter @agenticos/dashboard build 2>&1 | grep -E "api/agent/health|error" | head -10
```

Expected: build succeeds, route appears in compile output.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/app/api/
git commit -m "feat(api): replace /api/hermes/health with /api/agent/health"
```

## Task 30: Replace `app/api/hermes/runs` → `app/api/agent/runs`

**Files:**
- Create: `apps/dashboard/app/api/agent/runs/route.ts` (list)
- Create: `apps/dashboard/app/api/agent/runs/[id]/route.ts` (get)
- Delete: `apps/dashboard/app/api/hermes/runs/`

- [ ] **Step 1: Create the list route**

For MVP, runs are stored in a local JSONL file written by `scripts/run-curator.sh`. The dashboard reads from a known path.

```bash
mkdir -p apps/dashboard/app/api/agent/runs
cat > apps/dashboard/app/api/agent/runs/route.ts << 'EOF'
import "server-only";
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { RunRecord } from "@/lib/agent";

export const dynamic = "force-dynamic";

const RUNS_PATH = process.env.AGENTICOS_RUNS_PATH ?? "/var/log/agenticos/runs.jsonl";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);

  try {
    const content = await readFile(RUNS_PATH, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    const recent = lines.slice(-limit).reverse();
    const runs = recent
      .map((line) => {
        try { return RunRecord.parse(JSON.parse(line)); } catch { return null; }
      })
      .filter((r): r is z.infer<typeof RunRecord> => r !== null);
    return NextResponse.json({ runs });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ runs: [] });
    }
    return NextResponse.json({ runs: [], error: (err as Error).message }, { status: 500 });
  }
}
EOF
```

- [ ] **Step 2: Create the get-by-id route**

```bash
mkdir -p apps/dashboard/app/api/agent/runs/\[id\]
cat > apps/dashboard/app/api/agent/runs/\[id\]/route.ts << 'EOF'
import "server-only";
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { RunRecord } from "@/lib/agent";

export const dynamic = "force-dynamic";

const RUNS_PATH = process.env.AGENTICOS_RUNS_PATH ?? "/var/log/agenticos/runs.jsonl";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const content = await readFile(RUNS_PATH, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    for (const line of lines.reverse()) {
      try {
        const run = RunRecord.parse(JSON.parse(line));
        if (run.id === id) return NextResponse.json(run);
      } catch { /* skip */ }
    }
    return NextResponse.json({ error: "not found" }, { status: 404 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
EOF
```

- [ ] **Step 3: Delete old hermes/runs**

```bash
git rm -r apps/dashboard/app/api/hermes/runs/
```

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/app/api/
git commit -m "feat(api): replace /api/hermes/runs with /api/agent/runs"
```

## Task 31: Create `app/api/memory/peer-rep` and `/sessions` routes

**Files:**
- Create: `apps/dashboard/app/api/memory/peer-rep/route.ts`
- Create: `apps/dashboard/app/api/memory/sessions/route.ts`

- [ ] **Step 1: Peer representation route**

```bash
mkdir -p apps/dashboard/app/api/memory/peer-rep
cat > apps/dashboard/app/api/memory/peer-rep/route.ts << 'EOF'
import "server-only";
import { NextResponse } from "next/server";
import { getHonchoClient } from "@/lib/agent";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const peerId = url.searchParams.get("peer") ?? "josh";

  try {
    const honcho = getHonchoClient();
    const rep = await honcho.peers.representation(peerId);
    return NextResponse.json({ peer: peerId, representation: rep });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
EOF
```

- [ ] **Step 2: Sessions route**

```bash
mkdir -p apps/dashboard/app/api/memory/sessions
cat > apps/dashboard/app/api/memory/sessions/route.ts << 'EOF'
import "server-only";
import { NextResponse } from "next/server";
import { getHonchoClient } from "@/lib/agent";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 100);

  try {
    const honcho = getHonchoClient();
    const sessions = await honcho.sessions.list({ limit });
    return NextResponse.json({ sessions });
  } catch (err) {
    return NextResponse.json(
      { sessions: [], error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
EOF
```

- [ ] **Step 3: Verify build**

```bash
pnpm --filter @agenticos/dashboard build 2>&1 | grep -E "api/memory|error" | head -10
```

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/app/api/memory/
git commit -m "feat(api): /api/memory/peer-rep + /api/memory/sessions"
```

## Task 32: Delete `app/api/hermes/{cron,tools}/` (Honcho/Claude Code don't have these endpoints)

**Files:**
- Delete: `apps/dashboard/app/api/hermes/cron/`
- Delete: `apps/dashboard/app/api/hermes/tools/`
- Delete: `apps/dashboard/app/api/hermes/` (whole directory)
- Delete: `apps/dashboard/app/api/hermes/__tests__/`

- [ ] **Step 1: Delete the directory tree**

```bash
git rm -r apps/dashboard/app/api/hermes/
```

- [ ] **Step 2: Verify build**

```bash
pnpm --filter @agenticos/dashboard build 2>&1 | tail -20
```

Expected: build succeeds (no more `/api/hermes/*` routes; scheduler still works via instrumentation).

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/app/api/
git commit -m "chore(api): delete remaining /api/hermes/* routes (replaced)"
```

## Task 33: Rename hooks `use-hermes-*` → `use-agent-*` and `use-memory-*`

**Files:**
- Rename: `apps/dashboard/lib/hooks/use-hermes-health.ts` → `use-agent-health.ts`
- Rename: `apps/dashboard/lib/hooks/use-hermes-cron.ts` → `use-cron.ts` (drop "hermes" prefix)
- Create: `apps/dashboard/lib/hooks/use-memory-peer-rep.ts`
- Create: `apps/dashboard/lib/hooks/use-memory-sessions.ts`

- [ ] **Step 1: Rename use-hermes-health.ts**

```bash
cd apps/dashboard/lib/hooks
git mv use-hermes-health.ts use-agent-health.ts
```

- [ ] **Step 2: Update its content to hit `/api/agent/health`**

Edit `use-agent-health.ts`:

```typescript
"use client";
import { useQuery } from "@tanstack/react-query";

export interface AgentHealth {
  status: "ok" | "degraded";
  honcho: { reachable: boolean; latencyMs: number; error?: string };
}

export function useAgentHealth() {
  return useQuery<AgentHealth>({
    queryKey: ["agent", "health"],
    queryFn: async () => {
      const res = await fetch("/api/agent/health");
      if (!res.ok && res.status !== 503) throw new Error("health check failed");
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 25_000,
  });
}
```

Write that to the file (full overwrite):

```bash
cat > apps/dashboard/lib/hooks/use-agent-health.ts << 'EOF'
"use client";
import { useQuery } from "@tanstack/react-query";

export interface AgentHealth {
  status: "ok" | "degraded";
  honcho: { reachable: boolean; latencyMs: number; error?: string };
}

export function useAgentHealth() {
  return useQuery<AgentHealth>({
    queryKey: ["agent", "health"],
    queryFn: async () => {
      const res = await fetch("/api/agent/health");
      if (!res.ok && res.status !== 503) throw new Error("health check failed");
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 25_000,
  });
}
EOF
```

- [ ] **Step 3: Rename use-hermes-cron.ts**

```bash
git mv apps/dashboard/lib/hooks/use-hermes-cron.ts apps/dashboard/lib/hooks/use-cron.ts
```

Edit content — replace `/api/hermes/cron` with new scheduler-internal route (we'll need one). For now, stub it to read from `/api/agent/runs` filtered by `agent === "curator"`:

```bash
cat > apps/dashboard/lib/hooks/use-cron.ts << 'EOF'
"use client";
import { useQuery } from "@tanstack/react-query";

export interface CronEntry {
  id: string;
  agent: string;
  schedule: string;
  enabled: boolean;
  lastRun: string | null;
  nextRun: string | null;
}

export function useCron() {
  return useQuery<{ entries: CronEntry[] }>({
    queryKey: ["cron"],
    queryFn: async () => {
      const res = await fetch("/api/cron");
      if (!res.ok) throw new Error("failed to fetch cron");
      return res.json();
    },
    refetchInterval: 60_000,
  });
}
EOF
```

(We'll wire `/api/cron` in Task 41.)

- [ ] **Step 4: Create memory hooks**

```bash
cat > apps/dashboard/lib/hooks/use-memory-peer-rep.ts << 'EOF'
"use client";
import { useQuery } from "@tanstack/react-query";

export function useMemoryPeerRep(peer: string = "josh") {
  return useQuery<{ peer: string; representation: unknown }>({
    queryKey: ["memory", "peer-rep", peer],
    queryFn: async () => {
      const res = await fetch(`/api/memory/peer-rep?peer=${encodeURIComponent(peer)}`);
      if (!res.ok) throw new Error("failed to fetch peer rep");
      return res.json();
    },
    staleTime: 60_000,
  });
}
EOF

cat > apps/dashboard/lib/hooks/use-memory-sessions.ts << 'EOF'
"use client";
import { useQuery } from "@tanstack/react-query";

export interface MemorySession {
  id: string;
  workspace_id: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export function useMemorySessions(limit: number = 20) {
  return useQuery<{ sessions: MemorySession[] }>({
    queryKey: ["memory", "sessions", limit],
    queryFn: async () => {
      const res = await fetch(`/api/memory/sessions?limit=${limit}`);
      if (!res.ok) throw new Error("failed to fetch sessions");
      return res.json();
    },
    staleTime: 30_000,
  });
}
EOF
```

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/lib/hooks/
git commit -m "feat(hooks): rename hermes hooks; add memory peer-rep + sessions hooks"
```

## Task 34: Rename `HermesStatusChip` → `AgentStatusChip` and update header import

**Files:**
- Rename: `apps/dashboard/components/observability/HermesStatusChip.tsx` → `AgentStatusChip.tsx`
- Modify: `apps/dashboard/components/layout/header.tsx`

- [ ] **Step 1: Rename file**

```bash
git mv apps/dashboard/components/observability/HermesStatusChip.tsx apps/dashboard/components/observability/AgentStatusChip.tsx
```

- [ ] **Step 2: Update internal references**

Edit `AgentStatusChip.tsx`. Rename the exported component:

```bash
sed -i.bak 's/HermesStatusChip/AgentStatusChip/g; s/useHermesHealth/useAgentHealth/g; s/use-hermes-health/use-agent-health/g' apps/dashboard/components/observability/AgentStatusChip.tsx
rm apps/dashboard/components/observability/AgentStatusChip.tsx.bak
```

Manually inspect the file and adjust any other Hermes-specific labels (e.g., "Hermes" → "Agent" in tooltip text).

- [ ] **Step 3: Update header.tsx import**

Edit `apps/dashboard/components/layout/header.tsx`. Replace:

```typescript
import { HermesStatusChip } from "@/components/observability/HermesStatusChip";
```

with:

```typescript
import { AgentStatusChip } from "@/components/observability/AgentStatusChip";
```

And update the JSX `<HermesStatusChip />` to `<AgentStatusChip />`.

```bash
sed -i.bak 's/HermesStatusChip/AgentStatusChip/g' apps/dashboard/components/layout/header.tsx
rm apps/dashboard/components/layout/header.tsx.bak
```

- [ ] **Step 4: Verify typecheck + build**

```bash
pnpm --filter @agenticos/dashboard typecheck
pnpm --filter @agenticos/dashboard build 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/components/
git commit -m "refactor(ui): HermesStatusChip → AgentStatusChip"
```

## Task 35: Update RateLimitsPanel to render Max quota + Claude Code stats

**Files:**
- Modify: `apps/dashboard/components/observability/RateLimitsPanel.tsx`

- [ ] **Step 1: Read current panel**

```bash
head -50 apps/dashboard/components/observability/RateLimitsPanel.tsx
```

The panel was Hermes-shaped — rendered Anthropic API rate-limit headers. New version reads from local `/api/agent/runs` (the JSONL log) and computes a window-based quota view.

- [ ] **Step 2: Rewrite the panel**

```bash
cat > apps/dashboard/components/observability/RateLimitsPanel.tsx << 'EOF'
"use client";
import { useQuery } from "@tanstack/react-query";

interface Run {
  id: string;
  agent: string;
  status: string;
  startedAt: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

interface QuotaView {
  windowStart: string;
  windowEnd: string;
  totalCostUsd: number;
  totalTokens: number;
  runCount: number;
  // Max quota is roughly ~50 messages per 5h window (Claude Code 5x Pro)
  estimatedQuotaUsedPct: number;
}

const MAX_QUOTA_MESSAGES_5H = 50;

function computeQuota(runs: Run[]): QuotaView {
  const now = new Date();
  const windowMs = 5 * 60 * 60 * 1000;
  const windowStart = new Date(now.getTime() - windowMs);
  const recent = runs.filter((r) => new Date(r.startedAt) >= windowStart);
  const totalCostUsd = recent.reduce((acc, r) => acc + r.costUsd, 0);
  const totalTokens = recent.reduce((acc, r) => acc + r.inputTokens + r.outputTokens, 0);
  return {
    windowStart: windowStart.toISOString(),
    windowEnd: now.toISOString(),
    totalCostUsd,
    totalTokens,
    runCount: recent.length,
    estimatedQuotaUsedPct: Math.min(100, (recent.length / MAX_QUOTA_MESSAGES_5H) * 100),
  };
}

export function RateLimitsPanel() {
  const { data, isLoading } = useQuery<{ runs: Run[] }>({
    queryKey: ["agent", "runs", "for-quota"],
    queryFn: async () => {
      const res = await fetch("/api/agent/runs?limit=100");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  if (!data) return null;

  const quota = computeQuota(data.runs);

  return (
    <div className="p-4 space-y-3 border rounded-md">
      <h3 className="text-sm font-medium">Claude Max quota (last 5h)</h3>
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">
          {quota.runCount}/{MAX_QUOTA_MESSAGES_5H} messages
        </div>
        <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${quota.estimatedQuotaUsedPct}%` }}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs pt-2">
          <div>
            <div className="text-muted-foreground">Cost</div>
            <div className="font-mono">${quota.totalCostUsd.toFixed(3)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Tokens</div>
            <div className="font-mono">{quota.totalTokens.toLocaleString()}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
EOF
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm --filter @agenticos/dashboard typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/components/observability/RateLimitsPanel.tsx
git commit -m "refactor(ui): RateLimitsPanel renders Max quota window instead of API headers"
```

## Task 36: Update `lib/skills/curator.ts` to be a dispatch-side helper

**Files:**
- Modify: `apps/dashboard/lib/skills/curator.ts`
- Modify: `apps/dashboard/lib/skills/curator.test.ts`
- Delete (if present): `apps/dashboard/lib/skills/prompts/`

- [ ] **Step 1: Rewrite curator.ts to be a thin dispatch helper**

```bash
cat > apps/dashboard/lib/skills/curator.ts << 'EOF'
import "server-only";

/**
 * Curator dispatch helper. Phase 5 wires this into the scheduler:
 * the scheduler reads cron entries, finds the Curator entry, and invokes
 * this function which in turn shells out to /opt/agenticos/scripts/run-curator.sh
 * on the Droplet.
 *
 * In v1, the prompt + system message live in the script + Honcho user-model,
 * not here. This module is intentionally thin — its only job is to spawn
 * the canonical run-curator script and surface its run record.
 */

export const CURATOR_AGENT_ID = "curator";
export const CURATOR_SCRIPT_PATH =
  process.env.CURATOR_SCRIPT_PATH ?? "/opt/agenticos/scripts/run-curator.sh";

export interface CuratorRunOptions {
  triggeredBy: "scheduler" | "manual";
}

export async function runCurator(options: CuratorRunOptions): Promise<{ ok: boolean }> {
  // The actual subprocess invocation moves to lib/scheduler/scheduler.ts in Task 41.
  // This function exists so other code (UI "Run Now" button, future tests) can
  // import a stable handle even before scheduler integration.
  return Promise.resolve({ ok: true });
}
EOF
```

- [ ] **Step 2: Update curator.test.ts (will need full rewrite — Letta-shaped originally)**

```bash
cat > apps/dashboard/lib/skills/curator.test.ts << 'EOF'
import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { CURATOR_AGENT_ID, runCurator } from "./curator";

describe("curator helper", () => {
  it("exposes a stable agent id", () => {
    expect(CURATOR_AGENT_ID).toBe("curator");
  });

  it("runCurator returns ok in scaffold mode", async () => {
    const result = await runCurator({ triggeredBy: "manual" });
    expect(result.ok).toBe(true);
  });
});
EOF
```

- [ ] **Step 3: Run tests (expect pass)**

```bash
pnpm --filter @agenticos/dashboard test -- curator.test
```

- [ ] **Step 4: Delete leftover prompts dir if it was Letta-shaped**

```bash
if [ -d apps/dashboard/lib/skills/prompts ]; then
  git rm -r apps/dashboard/lib/skills/prompts
fi
```

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/lib/skills/
git commit -m "refactor(skills): curator helper as thin dispatch stub (real prompt moves to /opt/agenticos/prompts/)"
```

---

## Phase 4 — Curator script (~4 hr)

## Task 37: Create the Curator system prompt seed

**Files:**
- Create: `scripts/prompts/curator.md` (in repo, deployed to `/opt/agenticos/prompts/curator.md`)

- [ ] **Step 1: Write the seed prompt**

```bash
mkdir -p scripts/prompts
cat > scripts/prompts/curator.md << 'EOF'
You are the Curator agent for Josh's vault.

Your standing job: process inbox items older than 7 days, classify them by taxonomy, surface promotion candidates, and write your nightly summary to `wiki/_meta/curator-log.md`.

Your tools (provided via MCP):
- `vault.inbox.list` — list items older than threshold
- `vault.read` — read an item's content
- `vault.write` — write/append markdown files
- `vault.lint` — validate wiki link integrity
- `taxonomy.get` — get the active taxonomy definition
- `honcho.*` — persist observations + retrieve user-model context

Operating principles:
1. **Be brief.** Your log entries are one line per item. Long output is friction.
2. **Be conservative.** When classification is ambiguous, defer rather than promote. Surface uncertainty in the log.
3. **Learn.** When you encounter a novel pattern (e.g., "items tagged `#research/draft` without dates rarely belong in wiki"), record it via `honcho.add_message` with metadata `{type: "insight", scope: "vault_conventions"}`.
4. **Stay in scope.** Only write to `wiki/_meta/curator-log.md`. Don't modify other vault files unless explicitly tasked.

Budget cap: $1.00 per run (enforced externally by the dispatch script).

When you receive the daily trigger message ("Process today's inbox per standing instructions"), follow this sequence:
1. Read your current `vault_conventions` peer representation via `honcho.get_peer_representation`.
2. List inbox items > 7 days old.
3. For each, read content + classify against taxonomy + log result.
4. If you noticed a novel pattern, store it via `honcho.add_message` with insight metadata.
5. Return a final summary: items processed, classifications, promotion candidates, conflicts surfaced.
EOF
```

- [ ] **Step 2: Commit**

```bash
git add scripts/prompts/curator.md
git commit -m "feat(curator): initial system prompt seed (full prompt lives in Honcho user-model post-launch)"
```

## Task 38: Create the MCP config for Curator runs

**Files:**
- Create: `scripts/mcp-config.json` (in repo, deployed to `/etc/agenticos/mcp.json`)

- [ ] **Step 1: Write the MCP config**

The config wires the Curator's MCP tools. Adjust Honcho tool prefix based on what Task 14 discovered.

```bash
cat > scripts/mcp-config.json << 'EOF'
{
  "mcpServers": {
    "honcho": {
      "type": "http",
      "url": "http://127.0.0.1:8000/mcp",
      "headers": {}
    },
    "vault": {
      "type": "stdio",
      "command": "node",
      "args": ["/opt/agenticos/repo/apps/dashboard/lib/mcp-vault/server.js"],
      "env": {
        "VAULT_ROOT": "/opt/vault"
      }
    }
  }
}
EOF
```

⚠️ The `vault` MCP server here is the existing `apps/dashboard/lib/mcp-vault/server.ts` — compiled to JS at deploy time. Task 51 (deploy.sh) ensures it's built.

- [ ] **Step 2: Commit**

```bash
git add scripts/mcp-config.json
git commit -m "feat(curator): MCP config wiring Honcho + vault servers"
```

## Task 39: Write `scripts/run-curator.sh`

**Files:**
- Create: `scripts/run-curator.sh`

- [ ] **Step 1: Write the run script**

```bash
cat > scripts/run-curator.sh << 'SCRIPT'
#!/usr/bin/env bash
# Curator nightly dispatch script.
# Runs on the Droplet under systemd-timer. Invokes Claude Code with the
# Curator system prompt + MCP config, captures stream-json output, and
# appends a RunRecord to /var/log/agenticos/runs.jsonl.

set -euo pipefail

AGENTICOS_HOME="${AGENTICOS_HOME:-/opt/agenticos}"
PROMPT_PATH="${AGENTICOS_HOME}/prompts/curator.md"
MCP_CONFIG="${MCP_CONFIG_PATH:-/etc/agenticos/mcp.json}"
RUNS_LOG="${AGENTICOS_RUNS_PATH:-/var/log/agenticos/runs.jsonl}"
BUDGET_USD="${BUDGET_USD:-1.00}"
TIMEOUT_SEC="${TIMEOUT_SEC:-900}"  # 15 min hard cap

mkdir -p "$(dirname "${RUNS_LOG}")"

RUN_ID="curator-$(date -u +%Y%m%dT%H%M%SZ)-$$"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TRIGGER_MSG="Process today's inbox per standing instructions."

TMP_STDOUT="$(mktemp)"
TMP_STDERR="$(mktemp)"
trap 'rm -f "${TMP_STDOUT}" "${TMP_STDERR}"' EXIT

echo "[$(date -u +%FT%TZ)] starting curator run ${RUN_ID}" >&2

EXIT_CODE=0
timeout "${TIMEOUT_SEC}" claude \
  --print "${TRIGGER_MSG}" \
  --append-system-prompt-from "${PROMPT_PATH}" \
  --mcp-config "${MCP_CONFIG}" \
  --output-format=stream-json \
  --verbose \
  > "${TMP_STDOUT}" 2> "${TMP_STDERR}" || EXIT_CODE=$?

ENDED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Parse stream-json to extract totals
TOTAL_COST="$(jq -s '[.[] | select(.type == "result") | .total_cost_usd] | add // 0' < "${TMP_STDOUT}")"
INPUT_TOKENS="$(jq -s '[.[] | select(.type == "assistant") | .message.usage.input_tokens] | add // 0' < "${TMP_STDOUT}")"
OUTPUT_TOKENS="$(jq -s '[.[] | select(.type == "assistant") | .message.usage.output_tokens] | add // 0' < "${TMP_STDOUT}")"
CACHE_READ="$(jq -s '[.[] | select(.type == "assistant") | .message.usage.cache_read_input_tokens // 0] | add // 0' < "${TMP_STDOUT}")"
CACHE_CREATE="$(jq -s '[.[] | select(.type == "assistant") | .message.usage.cache_creation_input_tokens // 0] | add // 0' < "${TMP_STDOUT}")"
TOOL_CALLS="$(jq -s '[.[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use")] | length' < "${TMP_STDOUT}")"
IS_ERROR="$(jq -s '[.[] | select(.type == "result") | .is_error // false] | any' < "${TMP_STDOUT}")"

STATUS="completed"
ERROR_MSG="null"
if [ "${EXIT_CODE}" -ne 0 ]; then
  STATUS="failed"
  ERROR_MSG="$(jq -Rs . < "${TMP_STDERR}")"
elif [ "${IS_ERROR}" = "true" ]; then
  STATUS="failed"
  ERROR_MSG="\"agent reported error in result event\""
fi

# Budget check
if (( $(echo "${TOTAL_COST} > ${BUDGET_USD}" | bc -l) )); then
  STATUS="budget_exceeded"
  ERROR_MSG="\"cost ${TOTAL_COST} exceeded budget ${BUDGET_USD}\""
fi

# Write RunRecord (matches RunRecord Zod schema in lib/agent/types.ts)
jq -nc \
  --arg id "${RUN_ID}" \
  --arg agent "curator" \
  --arg status "${STATUS}" \
  --arg startedAt "${STARTED_AT}" \
  --arg endedAt "${ENDED_AT}" \
  --argjson costUsd "${TOTAL_COST}" \
  --argjson inputTokens "${INPUT_TOKENS}" \
  --argjson outputTokens "${OUTPUT_TOKENS}" \
  --argjson cacheReadTokens "${CACHE_READ}" \
  --argjson cacheCreationTokens "${CACHE_CREATE}" \
  --argjson toolCalls "${TOOL_CALLS}" \
  --argjson errorMessage "${ERROR_MSG}" \
  '{id: $id, agent: $agent, status: $status, startedAt: $startedAt, endedAt: $endedAt, costUsd: $costUsd, inputTokens: $inputTokens, outputTokens: $outputTokens, cacheReadTokens: $cacheReadTokens, cacheCreationTokens: $cacheCreationTokens, toolCalls: $toolCalls, errorMessage: $errorMessage}' \
  >> "${RUNS_LOG}"

echo "[$(date -u +%FT%TZ)] curator ${RUN_ID} ${STATUS} cost=\$${TOTAL_COST}" >&2

exit "${EXIT_CODE}"
SCRIPT
chmod +x scripts/run-curator.sh
```

- [ ] **Step 2: Commit**

```bash
git add scripts/run-curator.sh
git commit -m "feat(curator): run-curator.sh dispatches Claude Code + writes RunRecord JSONL"
```

## Task 40: Test Curator script against a fixture inbox item

**Files:** all on Droplet (after deploy in Phase 7) — but we can dry-run locally first

- [ ] **Step 1: Deploy scripts to Droplet manually for first test**

From Mac:
```bash
ssh deploy@<DROPLET_TAILSCALE_HOSTNAME> 'mkdir -p /opt/agenticos/prompts /etc/agenticos /opt/agenticos/scripts'
scp scripts/prompts/curator.md deploy@<DROPLET_TAILSCALE_HOSTNAME>:/opt/agenticos/prompts/curator.md
scp scripts/mcp-config.json deploy@<DROPLET_TAILSCALE_HOSTNAME>:/tmp/mcp.json
ssh deploy@<DROPLET_TAILSCALE_HOSTNAME> 'sudo mv /tmp/mcp.json /etc/agenticos/mcp.json && sudo chown deploy:deploy /etc/agenticos/mcp.json'
scp scripts/run-curator.sh deploy@<DROPLET_TAILSCALE_HOSTNAME>:/opt/agenticos/scripts/run-curator.sh
ssh deploy@<DROPLET_TAILSCALE_HOSTNAME> 'chmod +x /opt/agenticos/scripts/run-curator.sh'
```

- [ ] **Step 2: Create test inbox item**

```bash
ssh deploy@<DROPLET_TAILSCALE_HOSTNAME>
mkdir -p /opt/vault/inbox
cat > /opt/vault/inbox/test-classification.md << 'EOF'
---
created: 2026-04-25T10:00:00Z
tags: [research, draft]
---

# Test classification source

This is a placeholder inbox item to test that the Curator can read + classify
it. It is older than 7 days from the perspective of any reasonable now.
EOF
```

- [ ] **Step 3: Run the script (with low budget for safety)**

```bash
sudo mkdir -p /var/log/agenticos
sudo chown deploy:deploy /var/log/agenticos
BUDGET_USD=0.25 TIMEOUT_SEC=120 bash /opt/agenticos/scripts/run-curator.sh
```

- [ ] **Step 4: Inspect the result**

```bash
cat /var/log/agenticos/runs.jsonl | tail -1 | jq
```

Expected: a RunRecord JSON line. Should show `status: "completed"`, a positive cost, and tool calls > 0.

- [ ] **Step 5: Inspect the Curator's log entry**

```bash
cat /opt/vault/wiki/_meta/curator-log.md | tail -20
```

Expected: at least one new log entry referencing the test item.

- [ ] **Step 6: Clean up test fixture (optional)**

```bash
rm /opt/vault/inbox/test-classification.md
```

---

## Phase 5 — Scheduler dispatch (~3 hr)

## Task 41: Create `/api/cron` route reading from `cron.json`

**Files:**
- Create: `apps/dashboard/app/api/cron/route.ts`

- [ ] **Step 1: Write the route**

```bash
mkdir -p apps/dashboard/app/api/cron
cat > apps/dashboard/app/api/cron/route.ts << 'EOF'
import "server-only";
import { NextResponse } from "next/server";
import { readCronEntries } from "@/lib/scheduler/cron-io";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const entries = await readCronEntries();
    return NextResponse.json({ entries });
  } catch (err) {
    return NextResponse.json(
      { entries: [], error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
EOF
```

- [ ] **Step 2: Verify `lib/scheduler/cron-io.ts` exports `readCronEntries`**

```bash
grep "export" apps/dashboard/lib/scheduler/cron-io.ts | head -5
```

Expected: at least `readCronEntries` (or similar — `readCron`, `readCronFile`). If the name differs, either adjust this route's import OR add an alias.

- [ ] **Step 3: Test the route locally**

```bash
mkdir -p ~/.agenticos
echo '{"entries": [{"id": "curator-nightly", "agent": "curator", "schedule": "0 3 * * *", "enabled": true, "lastRun": null, "nextRun": null}]}' > ~/.agenticos/cron.json
pnpm --filter @agenticos/dashboard dev &
sleep 5
curl -s http://localhost:3000/api/cron | jq
```

Expected: returns the curator-nightly entry.

```bash
# Stop dev server
kill %1
```

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/app/api/cron/
git commit -m "feat(api): /api/cron reads ~/.agenticos/cron.json via scheduler lib"
```

## Task 42: Update scheduler to spawn `run-curator.sh` instead of HTTP-dispatch

**Files:**
- Modify: `apps/dashboard/lib/scheduler/scheduler.ts`

- [ ] **Step 1: Read current scheduler**

```bash
cat apps/dashboard/lib/scheduler/scheduler.ts
```

Note the current dispatch path (likely a fetch to /api/hermes/runs that no longer exists).

- [ ] **Step 2: Replace dispatch with subprocess spawn**

Edit `apps/dashboard/lib/scheduler/scheduler.ts`. The dispatch function should call `runCuratorScript` which shells out:

Append (or modify the existing dispatch function) so the body looks like:

```typescript
import { spawn } from "node:child_process";

const CURATOR_SCRIPT = process.env.CURATOR_SCRIPT_PATH ?? "/opt/agenticos/scripts/run-curator.sh";

async function dispatchCuratorRun(): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn(CURATOR_SCRIPT, [], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", (err) => resolve({ ok: false, error: err.message }));
    child.on("spawn", () => {
      child.unref();
      resolve({ ok: true });
    });
  });
}
```

Replace the old fetch-to-hermes call inside the cron-job handler with `await dispatchCuratorRun()`.

Read the file first, then edit it surgically:

```bash
cat apps/dashboard/lib/scheduler/scheduler.ts
```

(Manual edit follows; specifics depend on the file's exact structure.)

- [ ] **Step 3: Run scheduler tests**

```bash
pnpm --filter @agenticos/dashboard test -- scheduler.test
```

Update the test to mock `child_process.spawn` instead of `fetch`. If the test was tightly coupled to fetch-based dispatch, write a fresh test:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("server-only", () => ({}));

const mockSpawn = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
}));

import { dispatchCuratorRun } from "./scheduler"; // export this from scheduler.ts

describe("dispatchCuratorRun", () => {
  beforeEach(() => mockSpawn.mockReset());

  it("returns ok when subprocess spawns", async () => {
    const fakeChild = new EventEmitter() as EventEmitter & { unref: () => void };
    fakeChild.unref = vi.fn();
    mockSpawn.mockReturnValue(fakeChild);
    const promise = dispatchCuratorRun();
    fakeChild.emit("spawn");
    expect(await promise).toEqual({ ok: true });
  });

  it("returns error when spawn fails", async () => {
    const fakeChild = new EventEmitter() as EventEmitter & { unref: () => void };
    fakeChild.unref = vi.fn();
    mockSpawn.mockReturnValue(fakeChild);
    const promise = dispatchCuratorRun();
    fakeChild.emit("error", new Error("ENOENT"));
    expect(await promise).toEqual({ ok: false, error: "ENOENT" });
  });
});
```

Add `export` to the `dispatchCuratorRun` function in scheduler.ts so tests can import it.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @agenticos/dashboard test -- scheduler
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/lib/scheduler/
git commit -m "feat(scheduler): dispatch Curator via run-curator.sh subprocess"
```

## Task 43: Verify scheduler boots in instrumentation.ts

**Files:** verify `apps/dashboard/instrumentation.ts` references new paths

- [ ] **Step 1: Re-read instrumentation.ts**

```bash
cat apps/dashboard/instrumentation.ts
```

Expected: bootScheduler + bootMcpServer. Both should still work since their internal logic moved but external API didn't.

- [ ] **Step 2: Quick smoke test**

```bash
pnpm --filter @agenticos/dashboard dev &
sleep 8
curl -s http://localhost:3000/api/cron | jq
```

Expected: returns the curator-nightly entry. (Scheduler is booted; cron entries are readable.)

```bash
kill %1
```

- [ ] **Step 3: Commit (if any modifications were needed)**

If instrumentation.ts is unchanged, no commit needed. Otherwise:

```bash
git add apps/dashboard/instrumentation.ts
git commit -m "chore(boot): verify scheduler + MCP server start via instrumentation"
```

---

## Phase 6 — Dashboard wiring (~6 hr)

## Task 44: Wire dashboard observability page to new `/api/agent/*` routes

**Files:**
- Modify: `apps/dashboard/app/(dashboard)/observability/page.tsx` (or wherever the obs page lives)
- Modify: `apps/dashboard/components/observability/run-feed.tsx`

- [ ] **Step 1: Locate the observability page**

```bash
find apps/dashboard/app -name "page.tsx" | xargs grep -l "observability\|Observability" 2>/dev/null
```

- [ ] **Step 2: Verify run-feed component fetches from new endpoint**

```bash
grep -n "api/" apps/dashboard/components/observability/run-feed.tsx
```

If any references to `/api/hermes/runs` remain, change them to `/api/agent/runs`. The shape of the response (RunRecord JSON) is compatible enough that the UI shouldn't need structural changes.

- [ ] **Step 3: Verify metrics-sidebar.tsx pulls from /api/agent endpoints**

```bash
grep -n "api/" apps/dashboard/components/observability/metrics-sidebar.tsx
```

Update any `/api/hermes/*` references.

- [ ] **Step 4: Smoke test**

```bash
pnpm --filter @agenticos/dashboard dev &
sleep 5
open http://localhost:3000/observability
```

Inspect the page. Run feed should render (possibly empty if no runs yet). AgentStatusChip in header should show Honcho status (degraded if Honcho not running locally — that's fine).

```bash
kill %1
```

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/app/ apps/dashboard/components/
git commit -m "feat(ui): wire observability page to /api/agent/* endpoints"
```

## Task 45: Add memory inspection panel

**Files:**
- Create: `apps/dashboard/components/memory/MemoryPanel.tsx`
- Modify: observability page or sidebar to render it

- [ ] **Step 1: Create the panel component**

```bash
mkdir -p apps/dashboard/components/memory
cat > apps/dashboard/components/memory/MemoryPanel.tsx << 'EOF'
"use client";
import { useMemoryPeerRep } from "@/lib/hooks/use-memory-peer-rep";

export function MemoryPanel({ peer = "josh" }: { peer?: string }) {
  const { data, isLoading, error } = useMemoryPeerRep(peer);

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">Loading memory…</div>;
  if (error) return <div className="p-4 text-sm text-destructive">Memory unreachable</div>;
  if (!data) return null;

  const rep = data.representation;
  return (
    <div className="p-4 space-y-2 border rounded-md">
      <h3 className="text-sm font-medium">What I know about {peer}</h3>
      <pre className="text-xs whitespace-pre-wrap font-mono bg-muted p-2 rounded max-h-96 overflow-auto">
        {typeof rep === "string" ? rep : JSON.stringify(rep, null, 2)}
      </pre>
    </div>
  );
}
EOF
```

- [ ] **Step 2: Add it to the observability sidebar**

Edit `apps/dashboard/components/observability/metrics-sidebar.tsx`. Import and render `<MemoryPanel />` alongside `<RateLimitsPanel />`.

```typescript
import { MemoryPanel } from "@/components/memory/MemoryPanel";
import { RateLimitsPanel } from "@/components/observability/RateLimitsPanel";

// inside the sidebar JSX:
<MemoryPanel />
<RateLimitsPanel />
```

- [ ] **Step 3: Smoke test**

```bash
pnpm --filter @agenticos/dashboard dev &
sleep 5
open http://localhost:3000/observability
```

Memory panel should render with "Memory unreachable" locally (Honcho is on Droplet). That's expected — full functionality after deploy.

```bash
kill %1
```

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/components/memory/ apps/dashboard/components/observability/
git commit -m "feat(ui): MemoryPanel renders Honcho peer representation"
```

## Task 46: Add cost summary view

**Files:**
- Modify: `apps/dashboard/components/observability/RateLimitsPanel.tsx` (already done in Task 35 — verify)

- [ ] **Step 1: Confirm cost is rendered**

The RateLimitsPanel from Task 35 already shows quota + cost + tokens. Smoke-test it:

```bash
pnpm --filter @agenticos/dashboard dev &
sleep 5
open http://localhost:3000/observability
```

Confirm the "Claude Max quota" panel renders with a progress bar and stats.

```bash
kill %1
```

If anything looks wrong, fix and commit. If it looks good, no action needed.

## Task 47: End-to-end navigation test

**Files:** none (manual verification)

- [ ] **Step 1: Start dev server**

```bash
pnpm --filter @agenticos/dashboard dev
```

- [ ] **Step 2: Open in browser and click through all main pages**

- <http://localhost:3000/> — home
- <http://localhost:3000/observability> — runs, memory panel, quota panel
- <http://localhost:3000/architecture> — architecture map (existing page, should still render)
- <http://localhost:3000/memory> — wiki browser (existing page, should still render)

For each page, open browser devtools → Network tab → confirm no 404s on `/api/hermes/*` calls. Any leftovers indicate a missed reference; fix and re-test.

- [ ] **Step 3: Run typecheck + build + tests**

```bash
pnpm --filter @agenticos/dashboard typecheck
pnpm --filter @agenticos/dashboard build
pnpm --filter @agenticos/dashboard test
```

Expected: all green.

- [ ] **Step 4: Commit any fixes**

```bash
git add apps/dashboard/
git commit -m "chore(ui): final cleanup of stale hermes API references"
```

---

## Phase 7 — CI/CD wiring (~2 hr)

## Task 48: Write `deploy-dashboard.yml`

**Files:**
- Create: `.github/workflows/deploy-dashboard.yml`

- [ ] **Step 1: Write the workflow**

```bash
mkdir -p .github/workflows
cat > .github/workflows/deploy-dashboard.yml << 'EOF'
name: Deploy dashboard to App Platform

on:
  push:
    branches: [main]
    paths:
      - 'apps/dashboard/**'
      - 'packages/**'
      - 'pnpm-lock.yaml'
      - 'package.json'
      - '.github/workflows/deploy-dashboard.yml'

  workflow_dispatch:

concurrency:
  group: deploy-dashboard
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4

      - name: Trigger App Platform deploy
        uses: digitalocean/app_action/deploy@v2
        with:
          app_name: agenticos-dashboard
          token: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}
EOF
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy-dashboard.yml
git commit -m "ci: deploy-dashboard.yml triggers App Platform on push to main"
```

## Task 49: Write `deploy-droplet.yml`

**Files:**
- Create: `.github/workflows/deploy-droplet.yml`

- [ ] **Step 1: Write the workflow**

```bash
cat > .github/workflows/deploy-droplet.yml << 'EOF'
name: Deploy daemons to Droplet

on:
  push:
    branches: [main]
    paths:
      - 'scripts/**'
      - 'docker-compose.yml'
      - 'apps/dashboard/lib/mcp-vault/**'
      - 'apps/dashboard/lib/scheduler/**'
      - '.github/workflows/deploy-droplet.yml'

  workflow_dispatch:

concurrency:
  group: deploy-droplet
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DROPLET_HOST }}
          username: deploy
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          port: 22
          command_timeout: 10m
          script: /opt/agenticos/deploy.sh
EOF
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy-droplet.yml
git commit -m "ci: deploy-droplet.yml SSHes into Droplet and runs deploy.sh"
```

## Task 50: Write Droplet's `/opt/agenticos/deploy.sh`

**Files:**
- Create: `scripts/droplet-deploy.sh` (lives in repo, deployed to `/opt/agenticos/deploy.sh`)

- [ ] **Step 1: Write the script**

```bash
cat > scripts/droplet-deploy.sh << 'SCRIPT'
#!/usr/bin/env bash
# Droplet-side deploy script. Pulled by Phase 0 bootstrap; invoked by
# GitHub Actions via SSH on every push to main that touches scripts/ or
# docker-compose paths.

set -euo pipefail

REPO_DIR="/opt/agenticos/repo"
BRANCH="main"
LOG_PREFIX="[deploy $(date -u +%FT%TZ)]"

echo "${LOG_PREFIX} starting"

if [ ! -d "${REPO_DIR}" ]; then
  git clone https://github.com/EngineeringMoonBear/AgenticOS.git "${REPO_DIR}"
fi

cd "${REPO_DIR}"
git fetch origin "${BRANCH}"
git reset --hard "origin/${BRANCH}"
git clean -fd

# Sync scripts to canonical paths
sudo install -m 0755 scripts/run-curator.sh /opt/agenticos/scripts/run-curator.sh
sudo install -m 0644 scripts/prompts/curator.md /opt/agenticos/prompts/curator.md
sudo install -m 0644 scripts/mcp-config.json /etc/agenticos/mcp.json
sudo install -m 0644 scripts/agenticos-runtime.service /etc/systemd/system/agenticos-runtime.service 2>/dev/null || true
sudo install -m 0644 scripts/agenticos-curator.service /etc/systemd/system/agenticos-curator.service 2>/dev/null || true
sudo install -m 0644 scripts/agenticos-curator.timer /etc/systemd/system/agenticos-curator.timer 2>/dev/null || true

# Build dashboard if it changed (lightweight check)
if git diff --name-only HEAD@{1} HEAD 2>/dev/null | grep -q "apps/dashboard/lib/mcp-vault\|apps/dashboard/lib/scheduler" || [ ! -d apps/dashboard/.next ]; then
  echo "${LOG_PREFIX} building dashboard"
  pnpm install --frozen-lockfile
  pnpm --filter @agenticos/dashboard build
fi

# Restart services
sudo systemctl daemon-reload
sudo systemctl restart agenticos-curator.timer 2>/dev/null || true

# Docker compose stack — pull + restart what changed
cd /opt/agenticos
docker compose pull
docker compose up -d --no-deps honcho honcho-db

# Refresh GitHub Actions IP allowlist (Task 51)
sudo /opt/agenticos/scripts/refresh-github-ips.sh || echo "${LOG_PREFIX} WARN: github-ips refresh failed"

echo "${LOG_PREFIX} done"
SCRIPT
chmod +x scripts/droplet-deploy.sh
```

- [ ] **Step 2: Write the systemd unit + timer for Curator**

```bash
cat > scripts/agenticos-curator.service << 'EOF'
[Unit]
Description=AgenticOS Curator nightly run
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=deploy
Group=deploy
EnvironmentFile=/opt/agenticos/.env
WorkingDirectory=/opt/agenticos
ExecStart=/opt/agenticos/scripts/run-curator.sh
StandardOutput=append:/var/log/agenticos/curator-stdout.log
StandardError=append:/var/log/agenticos/curator-stderr.log
EOF

cat > scripts/agenticos-curator.timer << 'EOF'
[Unit]
Description=Run AgenticOS Curator nightly at 03:00 local
Requires=agenticos-curator.service

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
EOF
```

- [ ] **Step 3: Commit**

```bash
git add scripts/droplet-deploy.sh scripts/agenticos-curator.service scripts/agenticos-curator.timer
git commit -m "feat(deploy): Droplet deploy script + systemd Curator timer"
```

## Task 51: Write the GitHub Actions IP allowlist refresh script

**Files:**
- Create: `scripts/refresh-github-ips.sh`

- [ ] **Step 1: Write the refresh script**

```bash
cat > scripts/refresh-github-ips.sh << 'SCRIPT'
#!/usr/bin/env bash
# Refresh UFW SSH allowlist to current GitHub Actions runner IP ranges.
# Run once daily via cron + once per deploy.

set -euo pipefail

PROFILE_NAME="github-actions-ssh"
META_URL="https://api.github.com/meta"

# Fetch current actions IP ranges
TMP="$(mktemp)"
trap 'rm -f "${TMP}"' EXIT

curl -fsSL "${META_URL}" > "${TMP}"
IP_RANGES="$(jq -r '.actions[]' < "${TMP}")"

# Remove all existing ufw rules tagged with our comment
sudo ufw status numbered | awk -v profile="${PROFILE_NAME}" '$0 ~ profile {print $1}' | tr -d '[]' | sort -rn | while read -r N; do
  sudo ufw --force delete "${N}"
done

# Add fresh rules
while IFS= read -r CIDR; do
  sudo ufw allow from "${CIDR}" to any port 22 proto tcp comment "${PROFILE_NAME}" >/dev/null
done <<< "${IP_RANGES}"

echo "Refreshed $(echo "${IP_RANGES}" | wc -l) GitHub Actions IP rules"
SCRIPT
chmod +x scripts/refresh-github-ips.sh
```

- [ ] **Step 2: Run it once manually on Droplet to validate**

```bash
scp scripts/refresh-github-ips.sh deploy@<DROPLET_TAILSCALE_HOSTNAME>:/tmp/
ssh deploy@<DROPLET_TAILSCALE_HOSTNAME> 'sudo install -m 0755 /tmp/refresh-github-ips.sh /opt/agenticos/scripts/refresh-github-ips.sh && sudo /opt/agenticos/scripts/refresh-github-ips.sh'
```

Expected: "Refreshed N GitHub Actions IP rules" where N is ~30-50.

- [ ] **Step 3: Install daily cron on Droplet**

```bash
ssh deploy@<DROPLET_TAILSCALE_HOSTNAME>
echo "0 4 * * * /opt/agenticos/scripts/refresh-github-ips.sh > /var/log/agenticos/github-ips.log 2>&1" | sudo crontab -
sudo crontab -l
```

Expected: cron line listed.

- [ ] **Step 4: Commit**

```bash
git add scripts/refresh-github-ips.sh
git commit -m "feat(ci): refresh-github-ips.sh keeps UFW SSH allowlist current with GHA ranges"
```

## Task 51b: Set up Honcho pg_dump → Mac rsync backup

**Files:**
- Create: `scripts/backup-honcho.sh` (in repo, deployed to `/opt/agenticos/scripts/backup-honcho.sh`)

Implements spec §14 decision #5: daily pg_dump to Droplet `/opt/backups/`, then rsync to Mac under Time Machine coverage. Tailscale handles the link.

- [ ] **Step 1: Write backup script**

```bash
cat > scripts/backup-honcho.sh << 'SCRIPT'
#!/usr/bin/env bash
# Daily Honcho Postgres backup. Dumps to /opt/backups/ on Droplet, then
# rsyncs to Mac via Tailscale.

set -euo pipefail

BACKUP_DIR="/opt/backups"
TS="$(date -u +%Y-%m-%dT%H%M%SZ)"
DUMP_FILE="${BACKUP_DIR}/honcho-${TS}.sql.gz"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
MAC_TARGET="${MAC_TARGET:-}"   # set via env, e.g. josh@josh-mac.tailXXXX.ts.net:~/AgenticOS-backups/

mkdir -p "${BACKUP_DIR}"

# pg_dump from inside docker (no postgres-client needed on host)
docker compose -f /opt/agenticos/docker-compose.yml exec -T honcho-db \
  pg_dump -U honcho -d honcho --no-owner --no-privileges \
  | gzip > "${DUMP_FILE}"

echo "Backup written: $(du -h "${DUMP_FILE}" | cut -f1) ${DUMP_FILE}"

# Rsync to Mac if MAC_TARGET set
if [ -n "${MAC_TARGET}" ]; then
  rsync -avz --partial \
    "${DUMP_FILE}" \
    "${MAC_TARGET}" \
    && echo "Mirrored to ${MAC_TARGET}"
fi

# Rotate: delete dumps older than RETENTION_DAYS
find "${BACKUP_DIR}" -name "honcho-*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete

echo "Backup complete"
SCRIPT
chmod +x scripts/backup-honcho.sh
```

- [ ] **Step 2: Deploy to Droplet manually for first install**

```bash
scp scripts/backup-honcho.sh deploy@<DROPLET_TAILSCALE_HOSTNAME>:/tmp/
ssh deploy@<DROPLET_TAILSCALE_HOSTNAME> 'sudo install -m 0755 /tmp/backup-honcho.sh /opt/agenticos/scripts/backup-honcho.sh'
```

- [ ] **Step 3: Generate Droplet→Mac SSH key for backup rsync**

On Droplet:
```bash
ssh deploy@<DROPLET_TAILSCALE_HOSTNAME>
ssh-keygen -t ed25519 -f ~/.ssh/mac-backup -C "droplet-to-mac-backup" -N ""
cat ~/.ssh/mac-backup.pub
```

Copy the printed public key.

- [ ] **Step 4: Authorize Droplet on Mac**

On Mac:
```bash
mkdir -p ~/AgenticOS-backups
echo "<paste the Droplet's public key>" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

Verify Mac allows SSH from Tailscale (System Settings → General → Sharing → Remote Login ON). If your security posture requires it, restrict via `Match Address` in `/etc/ssh/sshd_config.d/`.

- [ ] **Step 5: Test backup once**

On Droplet:
```bash
MAC_TARGET="josh@josh-mac.tailXXXX.ts.net:~/AgenticOS-backups/" \
  /opt/agenticos/scripts/backup-honcho.sh
```

Expected: dump file appears on Mac under `~/AgenticOS-backups/`.

- [ ] **Step 6: Install daily cron on Droplet**

```bash
ssh deploy@<DROPLET_TAILSCALE_HOSTNAME>
( sudo crontab -l 2>/dev/null; echo "0 4 * * * MAC_TARGET='josh@josh-mac.tailXXXX.ts.net:~/AgenticOS-backups/' /opt/agenticos/scripts/backup-honcho.sh > /var/log/agenticos/backup.log 2>&1" ) | sudo crontab -
sudo crontab -l
```

Expected: backup cron line listed.

- [ ] **Step 7: Commit script to repo**

```bash
git add scripts/backup-honcho.sh
git commit -m "feat(backup): daily Honcho pg_dump → Mac rsync via Tailscale"
```

## Task 52: Configure GitHub repository secrets

**Files:** none (GitHub web console)

- [ ] **Step 1: Create deploy SSH keypair (separate from your personal key)**

On Mac:
```bash
ssh-keygen -t ed25519 -f ~/.ssh/agenticos-deploy-gha -C "github-actions"
```

- [ ] **Step 2: Add public key to Droplet's deploy user**

```bash
cat ~/.ssh/agenticos-deploy-gha.pub | ssh deploy@<DROPLET_TAILSCALE_HOSTNAME> 'cat >> ~/.ssh/authorized_keys'
```

- [ ] **Step 3: Set GitHub secrets**

GitHub repo → Settings → Secrets and variables → Actions → New repository secret. Add:

| Name | Value |
|---|---|
| `DIGITALOCEAN_ACCESS_TOKEN` | DO API token from DO → API → Tokens (Personal access tokens, Read+Write, "App Platform" scope) |
| `DEPLOY_SSH_KEY` | Contents of `~/.ssh/agenticos-deploy-gha` (the private key, NOT the .pub) |
| `DROPLET_HOST` | The Droplet's PUBLIC IPv4 (not Tailscale, since GHA runner isn't on Tailnet) |

- [ ] **Step 4: Verify secrets are saved**

GitHub UI shows the three secrets (values hidden, but names listed).

## Task 53: Test the full deploy pipeline with a dummy commit

**Files:** any small change

- [ ] **Step 1: Make a trivial commit**

```bash
echo "" >> README.md
git add README.md
git commit -m "test: trigger deploy pipeline"
git push origin main
```

- [ ] **Step 2: Watch the workflows**

GitHub repo → Actions tab. Both `deploy-dashboard` and `deploy-droplet` workflows should run.

- [ ] **Step 3: Verify dashboard deploys**

App Platform → agenticos-dashboard → Activity. New deploy started.

- [ ] **Step 4: Verify Droplet deploy.sh ran**

```bash
ssh deploy@<DROPLET_TAILSCALE_HOSTNAME>
tail -30 /var/log/agenticos/curator-stderr.log
tail -30 ~/.bash_history  # or check systemd journals
sudo journalctl -u agenticos-curator.timer --since "10 minutes ago"
```

Expected: deploy.sh ran, scripts updated.

- [ ] **Step 5: If anything failed, fix + push again**

Common issues:
- SSH key format wrong (must be unencrypted ed25519)
- DROPLET_HOST set to Tailscale IP (must be public IPv4 for GHA)
- UFW blocking GHA runner (the github-ips refresh script must have run at least once)

- [ ] **Step 6: Commit any fixes + retest**

---

## Phase 8 — End-to-end test (~open-ended, ~1 week elapsed)

## Task 54: Enable the Curator timer

**Files:** all on Droplet

- [ ] **Step 1: SSH in and enable the timer**

```bash
ssh deploy@<DROPLET_TAILSCALE_HOSTNAME>
sudo systemctl daemon-reload
sudo systemctl enable --now agenticos-curator.timer
sudo systemctl list-timers agenticos-curator.timer
```

Expected: timer listed with "next" showing 3:00 AM local.

- [ ] **Step 2: Trigger one run now (don't wait for 3 AM)**

```bash
sudo systemctl start agenticos-curator.service
sleep 60   # give it a minute
sudo journalctl -u agenticos-curator.service --since "2 minutes ago"
```

Expected: service started and exited 0.

## Task 55: Inspect first real run

**Files:** none

- [ ] **Step 1: View runs log**

```bash
tail -1 /var/log/agenticos/runs.jsonl | jq
```

Expected: a complete RunRecord with cost, tokens, tool calls.

- [ ] **Step 2: View Curator's log**

```bash
tail -20 /opt/vault/wiki/_meta/curator-log.md
```

Expected: at least one new entry from the run. Inspect quality.

- [ ] **Step 3: View Honcho's state**

```bash
curl -s http://127.0.0.1:8000/v1/peers/josh/representation | jq
```

Expected: Honcho has recorded the session. The peer representation may still be sparse on first run; it grows.

- [ ] **Step 4: Visit the dashboard from Mac**

```bash
open https://agenticos.gatheringatthegrove.com
```

Sign in via Cloudflare Access. Navigate to Observability. Should show:
- AgentStatusChip green (Honcho reachable)
- Run feed with 1 entry
- MemoryPanel showing Honcho peer rep
- RateLimitsPanel showing ~1 message of quota used

If anything's broken, debug from the browser devtools network tab.

## Task 56: Iterate over the next week

**Files:** evolving Curator behavior

- [ ] **Step 1: Let nightly runs accumulate**

Don't touch anything for 3-5 days. Each night at 3 AM, Curator runs, logs to vault, accumulates Honcho memory.

- [ ] **Step 2: Inspect Honcho's accumulated user model**

```bash
curl -s http://127.0.0.1:8000/v1/peers/josh/representation | jq
```

Should grow — Honcho's dialectic loop should be extracting patterns from Curator's interactions.

- [ ] **Step 3: Tune via Honcho's metadata or prompt seed**

If Curator behavior drifts (over-promotes, mis-classifies, writes too verbosely), adjust by:
- Adding a new sentence to `scripts/prompts/curator.md` (the seed)
- OR sending a directed correction message to Honcho via `curl POST /v1/peers/josh/messages` with insight metadata

- [ ] **Step 4: Commit any prompt/config tweaks**

```bash
git add scripts/prompts/curator.md
git commit -m "tune(curator): refine instruction based on first-week observations"
git push
```

(The push triggers redeploy automatically.)

- [ ] **Step 5: Declare MVP complete**

When you've watched the Curator run unsupervised for a week without intervention, and the dashboard renders the data correctly, foundation v2 v1 is shipped. Time to brainstorm v2.

---

## Final commit + tag

- [ ] **Step 1: Update task tracker**

```bash
cat > docs/runbooks/v1-shipped.md << 'EOF'
# AgenticOS Foundation v2 v1 — shipped

**Date:** $(date -u +%Y-%m-%d)

**What ships:**
- DO Droplet running Honcho + Claude Code + vault + Tailscale
- DO App Platform hosting dashboard at agenticos.gatheringatthegrove.com
- Cloudflare Access gating with Google SSO
- One Curator agent running nightly at 03:00 local
- Observability dashboard showing runs, memory, quota

**Cost:** $29/mo marginal on top of Claude Max.

**Next:** brainstorm v2 (multi-agent fleet, or beauty-pass UI).
EOF
git add docs/runbooks/v1-shipped.md
git commit -m "docs(runbook): v1 shipped"
git tag v1.0.0
git push origin main --tags
```

---

## Reference

- Foundation v2 spec: `docs/superpowers/specs/2026-05-20-agenticos-foundation-v2-design.md`
- ADR 0003 (scheduler ownership): `docs/adr/0003-scheduler-ownership.md`
- ADR 0004 (Hermes → Letta pivot, superseded): `docs/adr/0004-pivot-hermes-to-letta.md`
- Honcho docs: <https://docs.honcho.dev>
- Claude Code docs: <https://docs.anthropic.com/en/docs/claude-code>
- DO App Platform + GitHub Actions: <https://docs.digitalocean.com/products/app-platform/how-to/deploy-from-github-actions/>
- Tailscale: <https://tailscale.com/kb>
- Syncthing: <https://docs.syncthing.net/>

---

**Total estimated effort:** 20-30 hours active work over 2-3 weeks of evenings.

**Critical path:** Phase 0 (3 hr) → Phase 1 (2 hr) → Phase 2 (1 hr) → Phase 3 (6 hr) → Phase 4 (4 hr) → Phase 5 (3 hr) → Phase 6 (6 hr) → Phase 7 (2 hr) → Phase 8 (open).

**Risk hotspots:**
- Phase 1 Task 14 (Honcho MCP tool names) — if tools don't match spec contract, raise blocker before continuing
- Phase 3 Task 25 (`honcho-ai` SDK name + types) — verify exact npm package name on first install
- Phase 7 Task 53 (full deploy test) — most likely to expose secrets/permissions misconfigurations
