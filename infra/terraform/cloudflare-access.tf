# PREREQUISITE (one-time manual step in Cloudflare Zero Trust):
#   Configure Google as an Identity Provider:
#     Zero Trust dashboard → Settings → Authentication → Login methods
#     → Add new → Google → follow OAuth setup wizard
#   See: https://developers.cloudflare.com/cloudflare-one/identity/idp-integration/google/
#
# This data source looks up that Google IdP. If it doesn't exist yet, terraform
# apply will fail here with a clear error pointing back to this comment.

data "cloudflare_zero_trust_access_identity_provider" "google" {
  account_id = var.cloudflare_account_id
  name       = "Google"
}

resource "cloudflare_zero_trust_access_application" "dashboard" {
  account_id                 = var.cloudflare_account_id
  name                       = "AgenticOS Dashboard"
  domain                     = var.domain
  type                       = "self_hosted"
  session_duration           = "24h"
  auto_redirect_to_identity  = false
  allowed_idps               = [data.cloudflare_zero_trust_access_identity_provider.google.id]
  app_launcher_visible       = true
  http_only_cookie_attribute = true
}

resource "cloudflare_zero_trust_access_policy" "allow_josh" {
  account_id     = var.cloudflare_account_id
  application_id = cloudflare_zero_trust_access_application.dashboard.id
  name           = "Allow Josh"
  precedence     = 1
  decision       = "allow"

  include {
    email = [var.google_sso_email]
  }
}
