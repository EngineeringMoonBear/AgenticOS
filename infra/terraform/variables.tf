variable "do_token" {
  description = "DigitalOcean Personal Access Token with read+write to all resources"
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
