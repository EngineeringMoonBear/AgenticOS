# Placeholder A record for agenticos.gatheringatthegrove.com.
# The Cloudflare Tunnel (cloudflare-tunnel.tf) provides the real routing — this
# record exists so that the hostname resolves through Cloudflare's proxy. The
# 192.0.2.x range is RFC 5737 TEST-NET-1 and is never routed; Cloudflare's proxy
# intercepts before the IP is ever used.
#
# Once the Tunnel public-hostname route is in place, Cloudflare automatically
# manages a CNAME-equivalent record under the hood. Terraform-managing this A
# record keeps it idempotent and gives us something to point at on day 1.

resource "cloudflare_record" "agenticos" {
  zone_id = var.cloudflare_zone_id
  name    = "agenticos"
  type    = "A"
  content = "192.0.2.1"
  proxied = true
  ttl     = 1 # 1 = automatic when proxied

  comment = "Managed by Terraform; routed by Cloudflare Tunnel agenticos-app-platform"

  lifecycle {
    # The Tunnel ingress rule may rewrite this record; ignore drift on the content.
    ignore_changes = [content]
  }
}
