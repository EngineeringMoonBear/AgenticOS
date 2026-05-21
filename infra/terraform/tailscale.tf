# PREREQUISITE (one-time manual step in Tailscale admin):
#   Edit your tailnet ACL and add to the "tagOwners" block:
#     "tag:agenticos-droplet": ["autogroup:admin"]
#   See: https://tailscale.com/kb/1068/acl-tags
#
# Without that tagOwner entry, this resource will fail with a "tag not allowed" error.

resource "tailscale_tailnet_key" "droplet" {
  reusable      = false
  ephemeral     = false
  preauthorized = true
  expiry        = 3600 # seconds — key only needs to live long enough for cloud-init to consume it
  description   = "agenticos-droplet bootstrap"
  tags          = ["tag:agenticos-droplet"]
}
