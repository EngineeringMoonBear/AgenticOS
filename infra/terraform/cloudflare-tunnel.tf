resource "random_id" "tunnel_secret" {
  byte_length = 35
}

locals {
  # digitalocean_app.default_ingress returns a full URL like "https://xxx.ondigitalocean.app".
  # The Tunnel ingress rule needs the bare hostname for the HTTP Host header.
  app_platform_hostname = replace(replace(digitalocean_app.dashboard.default_ingress, "https://", ""), "http://", "")
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "agenticos" {
  account_id = var.cloudflare_account_id
  name       = "agenticos-app-platform"
  secret     = random_id.tunnel_secret.b64_std
  config_src = "cloudflare"
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "agenticos" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.agenticos.id

  config {
    ingress_rule {
      hostname = var.domain
      service  = "https://${local.app_platform_hostname}"

      origin_request {
        http_host_header = local.app_platform_hostname
      }
    }

    # Catch-all required by cloudflared.
    ingress_rule {
      service = "http_status:404"
    }
  }
}
