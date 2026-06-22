output "droplet_public_ip" {
  description = "Public IPv4 of the AgenticOS Droplet"
  value       = digitalocean_droplet.agenticos_droplet.ipv4_address
}

output "droplet_vpc_ip" {
  description = "VPC-private IPv4 of the AgenticOS Droplet (use this for App Platform → Droplet calls)"
  value       = digitalocean_droplet.agenticos_droplet.ipv4_address_private
}

output "droplet_tailscale_hostname" {
  description = "Short hostname for the Droplet on your Tailnet (resolves via MagicDNS once cloud-init completes `tailscale up`). The FQDN depends on your MagicDNS suffix (a separate identifier from the Tailnet ID) — find it with: tailscale status | grep agenticos-droplet"
  value       = "agenticos-droplet"
}

output "app_platform_url" {
  description = "DigitalOcean App Platform default URL for the dashboard"
  value       = digitalocean_app.dashboard.default_ingress
}

output "dashboard_public_url" {
  description = "User-facing dashboard URL (behind Cloudflare Access)"
  value       = "https://${var.domain}"
}

output "next_steps" {
  description = "Post-apply notes (most are one-time first-deploy setup; a routine apply needs none of them)"
  value       = <<EOT

================================================================================
Apply complete.

ROUTINE APPLY: nothing to do here. The dashboard auto-redeploys from `main` on
App Platform; the Droplet services are managed by their own deploy workflow.

FIRST-TIME SETUP ONLY (already done for an existing deployment):

  1. Agent model auth. The claude_local / codex_local adapters run the local
     `claude` / codex CLIs authenticated via your Anthropic / OpenAI
     SUBSCRIPTION (OAuth) — not API billing. One-time, on the Droplet; the
     OAuth state persists on the backed-up Droplet volume:
       ssh -i ~/.ssh/agenticos-droplet deploy@${digitalocean_droplet.agenticos_droplet.ipv4_address}
       claude /login        # follow the device-code URL, then sign in
     (To run an agent on API billing instead, set the provider key in
     Paperclip's Secrets — not in terraform.)

  2. Dashboard (Google SSO — must be ${var.google_sso_email}):
       https://${var.domain}

  3. Tailscale on your Mac (needed to reach VPC-only services — Paperclip on
     :3100, the Syncthing GUI): brew install --cask tailscale && open -a Tailscale

  4. Pair Syncthing (Droplet GUI, reachable only over Tailscale):
       open http://agenticos-droplet:8384
       # or: tailscale status | grep agenticos-droplet  → open http://<ip>:8384
================================================================================
EOT
}
