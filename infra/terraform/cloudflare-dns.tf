# CNAME for agenticos.gatheringatthegrove.com → App Platform's ondigitalocean.app
# hostname, proxied by Cloudflare. Cloudflare proxy terminates TLS at its edge
# and forwards to App Platform's origin. Cloudflare Access (cloudflare-access.tf)
# gates this hostname with Google SSO before any traffic reaches App Platform.
#
# We initially attempted a Cloudflare Tunnel (cfd_tunnel) routing to App Platform
# but Tunnels require a cloudflared connector running with the tunnel token, which
# would mean installing cloudflared on the Droplet just to proxy to a *publicly*
# reachable App Platform URL — unnecessary complexity. App Platform is already
# publicly reachable, so a standard proxied CNAME is the right pattern.

locals {
  # digitalocean_app.default_ingress returns "https://xxx.ondigitalocean.app";
  # strip the scheme + trailing slash to get the bare hostname for the CNAME.
  app_platform_hostname = trimsuffix(
    replace(replace(digitalocean_app.dashboard.default_ingress, "https://", ""), "http://", ""),
    "/"
  )
}

resource "cloudflare_record" "agenticos" {
  zone_id = var.cloudflare_zone_id
  name    = "agenticos"
  type    = "CNAME"
  content = local.app_platform_hostname
  proxied = true
  ttl     = 1 # 1 = automatic when proxied
  comment = "Managed by Terraform; agenticos.gatheringatthegrove.com → App Platform"
}
