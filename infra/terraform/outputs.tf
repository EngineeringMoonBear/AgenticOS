output "droplet_public_ip" {
  description = "Public IPv4 of the AgenticOS Droplet"
  value       = digitalocean_droplet.agenticos_droplet.ipv4_address
}

output "droplet_vpc_ip" {
  description = "VPC-private IPv4 of the AgenticOS Droplet (use this for App Platform → Droplet calls)"
  value       = digitalocean_droplet.agenticos_droplet.ipv4_address_private
}

output "droplet_tailscale_hostname" {
  description = "Expected Tailscale FQDN of the Droplet (after cloud-init `tailscale up` completes)"
  value       = "agenticos-droplet.${var.tailscale_tailnet}.ts.net"
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
  description = "Manual follow-ups after `terraform apply` completes"
  value       = <<EOT

================================================================================
Apply complete. Next manual steps:

1. SSH to the Droplet and complete Claude Code OAuth:
     ssh -i ~/.ssh/agenticos-droplet deploy@${digitalocean_droplet.agenticos_droplet.ipv4_address}
     claude /login
   (follow the device-code URL in your browser, sign in with your Claude Max account)

2. Visit the dashboard:
     https://${var.domain}
   (Google SSO required — must be ${var.google_sso_email})

3. Install Tailscale on your Mac if you haven't:
     brew install --cask tailscale && open -a Tailscale

4. Pair Syncthing (Droplet GUI is at http://agenticos-droplet.${var.tailscale_tailnet}.ts.net:8384,
   reachable only over Tailscale).

5. Attach the App Platform app to the VPC (one-time UI step the provider can't do):
     DO Console → Apps → agenticos-dashboard → Settings → VPC → select agenticos-vpc

================================================================================
EOT
}
