# AgenticOS Droplet — OOM mitigation & resource alerting (GOL-53)

On 2026-07-04 the `agenticos-droplet` hit RAM ~103% and OOM-crashed the stack,
which took down the App Platform dashboard (it depends on the Droplet's
VPC-private OpenViking / Paperclip / Postgres). This runbook covers the
guardrails added to prevent recurrence and how to finish applying them.

## What this change ships

1. **Container memory limits** (`docker-compose.yml`) — every service now has a
   `mem_limit`/`mem_reservation`. A runaway agent/LLM run is now contained to a
   single container OOM-kill instead of taking the whole Droplet down.
   `paperclip-server` (which spawns every agent subprocess) is the primary
   source and is capped at 3g; `ollama` (elastic model cache) at 2g.
   **Deploys automatically** via `.github/workflows/deploy-droplet.yml` on merge
   to `main` (root `docker-compose.yml` is a trigger path) — no manual step.

2. **Swap file** (`infra/cloud-init/droplet-bootstrap.yaml.tpl`) — 4G swap,
   `vm.swappiness=10`, as an OOM safety net. Cloud-init only runs at first boot,
   so this covers **future** Droplets automatically. For the **existing** box,
   run the one-shot below once (needs root; cloud-init drift is intentionally
   ignored in `droplet.tf`).

3. **DO native alert policies** (`infra/terraform/monitor-alerts.tf`) — memory
   >80%/>90%, disk >85%, CPU >85%. The DO metrics agent is already running
   (`monitoring = true`), so this only adds the alerting that was missing.
   Applied on the next `terraform apply` (needs the DO token — the AgenticOS
   Infra 1Password item).

## Finish-up steps

### Existing Droplet swap (one-shot, root)
```bash
ssh root@$DROPLET <<'EOF'
test -f /swapfile || (fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile)
grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf
free -h && swapon --show
EOF
```

### Apply the alert policies
```bash
cd infra/terraform
source ../scripts/load-secrets.sh   # AgenticOS Infra tokens from 1Password
terraform plan   # review: 4 digitalocean_monitor_alert to add
terraform apply
```
To also route alerts to Discord, set `TF_VAR_alert_slack='{url="https://discord.com/api/webhooks/…/slack",channel="#alerts"}'`
(DO's Slack alert type posts to a Discord webhook when you append `/slack`).

## Right-sizing (separate decision)
The box is `s-2vcpu-4gb`. If the mem_limits above prove too tight under real
concurrency, bump `var.droplet_size` to `s-2vcpu-8gb` (+~$24/mo) and
`terraform apply` (brief power-off→resize→power-on; disk is NOT resized so it
stays reversible). This is a cost decision for the board, tracked separately —
not bundled into this mitigation PR.
