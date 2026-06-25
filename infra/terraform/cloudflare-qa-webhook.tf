# Cloudflare Access service token for machine-to-machine delivery of GitHub
# Actions → Paperclip routine webhooks.
#
# WHY: paperclip.gatheringatthegrove.com is behind Cloudflare Access (Google
# SSO) — great for humans, but a GitHub Actions runner POSTing to a routine's
# webhook would just get 302'd to the Google login. A *service token* is a
# non-interactive credential (Client-Id + Client-Secret headers) that bypasses
# the SSO gate for one machine client.
#
# SCOPE: rather than letting the token reach the whole Paperclip host, this
# defines a SEPARATE, path-scoped Access application covering ONLY the routine
# webhook delivery path:
#   POST https://paperclip.gatheringatthegrove.com/api/routine-triggers/public/<publicId>/fire
# Cloudflare matches the most-specific application, so requests to that path are
# gated by the service-token policy here, while everything else on the host stays
# behind the Google-SSO `dashboard`/`paperclip` Access apps. If the token leaks,
# the blast radius is "can fire routine webhooks," not "full Paperclip API."

resource "cloudflare_zero_trust_access_service_token" "qa_smoke_webhook" {
  account_id = var.cloudflare_account_id
  name       = "odoocker-qa-smoke-webhook"
  # Default duration is non-expiring; rotate via `terraform taint` if needed.
}

resource "cloudflare_zero_trust_access_application" "paperclip_routine_webhook" {
  account_id = var.cloudflare_account_id
  name       = "AgenticOS Paperclip — routine webhooks (service token)"
  # Path-scoped: only the routine-trigger fire endpoint. More specific than the
  # host-wide `paperclip` Access app, so it wins for this path.
  domain                     = "${var.paperclip_domain}/api/routine-triggers/public"
  type                       = "self_hosted"
  session_duration           = "0s" # non-identity / no session for a machine endpoint
  app_launcher_visible       = false
  http_only_cookie_attribute = true
}

resource "cloudflare_zero_trust_access_policy" "paperclip_webhook_allow_service_token" {
  account_id     = var.cloudflare_account_id
  application_id = cloudflare_zero_trust_access_application.paperclip_routine_webhook.id
  name           = "Allow QA smoke service token"
  precedence     = 1
  decision       = "non_identity" # service-token auth, no human identity

  include {
    service_token = [cloudflare_zero_trust_access_service_token.qa_smoke_webhook.id]
  }
}

# The CI client credentials. Put them in odoocker's GitHub Actions secrets
# (CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET) and have the qa-smoke workflow
# send them as `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers on the
# webhook POST. See docs/runbooks/qa-smoke-paperclip-webhook.md.
output "qa_smoke_access_client_id" {
  description = "Cloudflare Access service-token Client-Id for the odoocker QA-smoke webhook (not secret)."
  value       = cloudflare_zero_trust_access_service_token.qa_smoke_webhook.client_id
}

output "qa_smoke_access_client_secret" {
  description = "Cloudflare Access service-token Client-Secret. Capture once (terraform output -raw) into 1Password + odoocker GH secret CF_ACCESS_CLIENT_SECRET."
  value       = cloudflare_zero_trust_access_service_token.qa_smoke_webhook.client_secret
  sensitive   = true
}
