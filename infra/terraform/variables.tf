variable "do_token" {
  description = "DigitalOcean least-privilege scoped PAT: read+write on droplet + app + ssh_key + vpc + monitoring ONLY (GOL-75) — the five resource types this root config manages. Sourced from op://Goldberry Grove - Admin/Grove Infra/do_token_scoped. NOT a full-account token."
  type        = string
  sensitive   = true
}

variable "tailscale_api_key" {
  description = "Tailscale API key (or OAuth client) with auth_keys:write scope"
  type        = string
  sensitive   = true
}

variable "tailscale_tailnet" {
  description = "Tailscale tailnet identifier accepted in REST API URL paths. Use your Tailnet NAME (domain-style, e.g. 'goldberrygrove.farm') from https://login.tailscale.com/admin/general — NOT the separate 'Tailnet ID' field on that page, which the REST API doesn't accept. Alternative: literal '-' for the API-key-wildcard."
  type        = string
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token with DNS:Edit + Access:Edit + Tunnel:Edit on the zone"
  type        = string
  sensitive   = true
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for gatheringatthegrove.com"
  type        = string
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID (find in any zone's Overview page sidebar)"
  type        = string
}

variable "do_region" {
  description = "DigitalOcean region slug"
  type        = string
  default     = "nyc1"
}

variable "droplet_size" {
  description = "DigitalOcean Droplet size slug"
  type        = string
  default     = "s-2vcpu-4gb"
}

variable "domain" {
  description = "Public hostname for the AgenticOS dashboard"
  type        = string
  default     = "agenticos.gatheringatthegrove.com"
}

variable "google_sso_email" {
  description = "Email allowed through Cloudflare Access (Google SSO)"
  type        = string
  default     = "josh@goldberrygrove.farm"
}

variable "ssh_public_key_path" {
  description = "Path to the SSH public key to install on the Droplet"
  type        = string
  default     = "~/.ssh/agenticos-droplet.pub"
}

variable "github_repo" {
  description = "owner/name of the GitHub repo to deploy on App Platform"
  type        = string
  default     = "EngineeringMoonBear/AgenticOS"
}

variable "github_branch" {
  description = "Git branch App Platform should track"
  type        = string
  default     = "main"
}

# ---------------------------------------------------------------------------
# Secrets injected at apply time. Never committed.
#
# Both of these end up as `type = "SECRET"` env vars on the App Platform
# spec, encrypted at rest by DigitalOcean. At apply time, source them from
# 1Password:
#
#   TF_VAR_agenticos_db_password=$(op read "op://Goldberry Grove - Admin/AgenticOS Infra/agenticos_db_password") \
#   TF_VAR_openviking_root_api_key=$(op read "op://Goldberry Grove - Admin/AgenticOS Infra/openviking_root_api_key") \
#     terraform -chdir=infra/terraform apply
# ---------------------------------------------------------------------------

variable "agenticos_db_password" {
  description = "Postgres password for the agenticos user. Must match what was set in /opt/agenticos/.env (POSTGRES_PASSWORD via AGENTICOS_DB_PASSWORD) at cloud-init time. Used to build the AGENTICOS_DB_URL env var on App Platform."
  type        = string
  sensitive   = true
}

variable "openviking_root_api_key" {
  description = "OpenViking root API key. Must match OPENVIKING_ROOT_API_KEY in /opt/agenticos/.env on the Droplet. Used as OPENVIKING_API_KEY on App Platform (the name the Hermes plugin + dashboard client both expect)."
  type        = string
  sensitive   = true
}

variable "paperclip_company_id" {
  description = "UUID of the GOL company row in Paperclip's companies table. Used as PAPERCLIP_COMPANY_ID on App Platform. Find via: psql into the Paperclip DB and SELECT id FROM companies WHERE name LIKE '%GOL%' OR name LIKE '%Goldberry%'. Store in 1Password under 'AgenticOS Infra / paperclip_company_id'."
  type        = string
}

variable "paperclip_board_key" {
  description = "Paperclip Board API key sent as Authorization: Bearer on every dashboard→Paperclip request. Store in 1Password under 'AgenticOS Infra / paperclip_board_key'. Used as PAPERCLIP_BOARD_KEY on App Platform."
  type        = string
  sensitive   = true
}

variable "paperclip_domain" {
  description = "Public hostname for Paperclip's board UI, fronted by Cloudflare Access + a cloudflared tunnel (see cloudflare-tunnel.tf). Kept distinct from var.domain (the dashboard) so the two apps have independent Access apps/policies."
  type        = string
  default     = "paperclip.gatheringatthegrove.com"
}

variable "paperclip_tunnel_secret" {
  description = <<-EOT
    Base64-encoded (32–256 byte) secret for the Paperclip cloudflared tunnel.
    1Password is the single source of truth — generate once and store it, then
    pass it in at apply time so Terraform consumes (never generates) it:

      op item create --category=password --title='paperclip_tunnel_secret' \
        --vault='Goldberry Grove - Admin' \
        password="$(openssl rand -base64 32)"
      export TF_VAR_paperclip_tunnel_secret=$(op read \
        "op://Goldberry Grove - Admin/AgenticOS Infra/paperclip_tunnel_secret")

    Mirrors the op-read→TF_VAR pattern used by agenticos_db_password and
    openviking_root_api_key. The derived run token (a stable function of this
    secret + the tunnel ID) is exposed as the `paperclip_tunnel_token` output;
    that token is what the cloudflared compose service consumes via .env.
  EOT
  type        = string
  sensitive   = true
}

variable "alert_emails" {
  # DO's alert API rejects any recipient that is not a VERIFIED team member on
  # the account with "400 email is not verified". The verified owner of this
  # account (team MoonBear) is joshua_dunbar@me.com — josh@goldberrygrove.farm
  # is NOT a verified DO team member, so it 400s the whole create. That is why
  # GOL-53's alerts (PR #230) were merged but never applied. Default to the
  # verified address so `apply` succeeds and config == applied state (clean
  # zero-drift plan). To route alerts to josh@goldberrygrove.farm instead,
  # first invite+verify it under DO → Settings → Team, then update this default.
  description = "Email addresses that receive DigitalOcean droplet resource alerts (memory/disk/load). Must be VERIFIED DO team members. Defaults to the verified account owner."
  type        = list(string)
  default     = ["joshua_dunbar@me.com"]
}

variable "alert_slack" {
  description = "Optional Slack/Discord-compatible incoming-webhook for DO alerts. Leave url empty to send email only. (DO's Slack alert type also posts to Discord webhooks with /slack appended.)"
  type        = object({ url = string, channel = string })
  default     = { url = "", channel = "" }
}
