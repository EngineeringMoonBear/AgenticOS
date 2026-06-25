# Paperclip board UI behind Cloudflare Access (paperclip.gatheringatthegrove.com).
#
# WHY a tunnel here, but a plain proxied CNAME for the dashboard (cloudflare-dns.tf):
# the dashboard runs on App Platform, which is *publicly* reachable, so Cloudflare
# can proxy straight to its origin. Paperclip is the opposite — paperclip-server
# binds 10.116.16.2:3100 inside the VPC behind ufw `default deny incoming`. There
# is nothing public to point a CNAME at. A cloudflared connector solves this by
# dialing OUT from the Droplet to Cloudflare's edge (443), so we expose the board
# without opening a single new inbound port.
#
# The connector runs as the `cloudflared` service in docker-compose.yml. Because
# it shares the compose network, its tunnel origin is the internal Docker DNS name
# `http://paperclip-server:3100` (the ingress rule below) — it never traverses the
# host VPC port map or ufw, so the tunnel keeps working even if those drift.
#
# Auth is defense-in-depth: Cloudflare Access (Google SSO) gates the edge, and
# Paperclip's own better-auth still runs (PAPERCLIP_DEPLOYMENT_MODE=authenticated).
# For better-auth to emit correct cookies/redirects behind the proxy, the
# paperclip-server service sets PAPERCLIP_PUBLIC_URL=https://paperclip.<domain>
# (docker-compose.yml), which also auto-allowlists the hostname.

# Named, remotely-managed tunnel. `config_src = "cloudflare"` means the ingress
# rules live in the cloudflared_config resource below (not a local config.yml),
# and the connector authenticates with the run token (token mode).
#
# v4.52 note: the secret argument is `secret` (renamed to `tunnel_secret` in v5)
# and the computed `.cname` attribute is available (removed in v5). Keep this in
# mind if/when the Cloudflare provider is bumped to v5.
resource "cloudflare_zero_trust_tunnel_cloudflared" "paperclip" {
  account_id = var.cloudflare_account_id
  name       = "agenticos-paperclip"
  secret     = var.paperclip_tunnel_secret
  config_src = "cloudflare"
}

# Ingress: the public hostname routes to paperclip-server over the internal
# compose network. The trailing catch-all (service-only, no hostname) is required
# by cloudflared — anything that isn't the paperclip hostname gets a 404 instead
# of leaking to some default origin.
resource "cloudflare_zero_trust_tunnel_cloudflared_config" "paperclip" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.paperclip.id

  config {
    ingress_rule {
      hostname = var.paperclip_domain
      service  = "http://paperclip-server:3100"
    }
    ingress_rule {
      service = "http_status:404"
    }
  }
}

# Proxied CNAME: paperclip.<domain> → <tunnel-id>.cfargotunnel.com. `proxied`
# routes the hostname through Cloudflare's edge (where Access enforces SSO) and
# on into the tunnel. ttl = 1 is "automatic", required when proxied.
resource "cloudflare_record" "paperclip" {
  zone_id = var.cloudflare_zone_id
  name    = "paperclip"
  type    = "CNAME"
  content = cloudflare_zero_trust_tunnel_cloudflared.paperclip.cname
  proxied = true
  ttl     = 1
  comment = "Managed by Terraform; paperclip.gatheringatthegrove.com → cloudflared tunnel → paperclip-server:3100"
}

# Cloudflare Access application for the Paperclip hostname. Mirrors the dashboard
# app (cloudflare-access.tf) 1:1 and reuses the SAME Google IdP data source, so
# both apps share one identity provider. `auto_redirect_to_identity = true` skips
# the single-option IdP chooser and jumps straight to Google (the dashboard keeps
# the chooser; Paperclip doesn't need it).
resource "cloudflare_zero_trust_access_application" "paperclip" {
  account_id                 = var.cloudflare_account_id
  name                       = "AgenticOS Paperclip"
  domain                     = var.paperclip_domain
  type                       = "self_hosted"
  session_duration           = "24h"
  auto_redirect_to_identity  = true
  allowed_idps               = [data.cloudflare_zero_trust_access_identity_provider.google.id]
  app_launcher_visible       = true
  http_only_cookie_attribute = true
}

# Policy: allow only Josh's Google identity. The provider (v4) binds a policy to
# one application via application_id, so this is a separate resource from the
# dashboard's allow_josh — same identity (var.google_sso_email), new binding.
resource "cloudflare_zero_trust_access_policy" "allow_josh_paperclip" {
  account_id     = var.cloudflare_account_id
  application_id = cloudflare_zero_trust_access_application.paperclip.id
  name           = "Allow Josh"
  precedence     = 1
  decision       = "allow"

  include {
    email = [var.google_sso_email]
  }
}

# Run token for the cloudflared connector. A deterministic function of the tunnel
# secret + tunnel ID (so it's stable across applies). 1Password stays the source
# of truth for the *secret*; this token is downstream and write-once. After the
# first apply, capture it into the SHARED 'AgenticOS Infra' item (the one
# load-secrets.sh reads — do NOT create a separate item, or it won't load):
#
#   terraform output -raw paperclip_tunnel_token | op item edit 'AgenticOS Infra' \
#     --vault='Goldberry Grove - Admin' 'paperclip_tunnel_token[password]=-'
#
# Then on the Droplet, PAPERCLIP_TUNNEL_TOKEN in /opt/agenticos/.env is what the
# cloudflared compose service reads. See docs/runbooks/paperclip-cloudflare-access.md.
output "paperclip_tunnel_token" {
  description = "cloudflared run token for the Paperclip tunnel. Store in 1Password as 'AgenticOS Infra / paperclip_tunnel_token' and set as PAPERCLIP_TUNNEL_TOKEN in the Droplet's /opt/agenticos/.env."
  value       = cloudflare_zero_trust_tunnel_cloudflared.paperclip.tunnel_token
  sensitive   = true
}
