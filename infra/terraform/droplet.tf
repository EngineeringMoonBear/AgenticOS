locals {
  cloud_init = templatefile("${path.module}/../cloud-init/droplet-bootstrap.yaml.tpl", {
    ts_authkey    = tailscale_tailnet_key.droplet.key
    github_repo   = var.github_repo
    deploy_pubkey = local.ssh_public_key
    # Single source of truth for the OpenViking root API key: 1Password
    # (op://Goldberry Grove - Admin/AgenticOS Infra/openviking_root_api_key),
    # the SAME var App Platform's dashboard consumes (app-platform.tf). Passing
    # it into cloud-init instead of generating it on the Droplet guarantees the
    # server, Hermes, and the dashboard never diverge.
    openviking_root_api_key = var.openviking_root_api_key
    # Single source of truth for the AgenticOS Postgres password: 1Password
    # (op://Goldberry Grove - Admin/AgenticOS Infra/agenticos_db_password),
    # the SAME var App Platform's dashboard consumes (app-platform.tf builds
    # AGENTICOS_DB_URL from it). Passing it in instead of generating it on
    # the Droplet guarantees the Postgres container and the dashboard's DB
    # URL never diverge on a re-provision. NOTE: this only keeps the .env
    # honest — the running agenticos-db container only reads POSTGRES_PASSWORD
    # on first init of its data volume, so rotating the value here does NOT
    # rotate the actual Postgres role password on an existing Droplet. See
    # docs/runbooks/backup-and-recovery.md for the ALTER USER / volume-reset
    # rotation procedure.
    agenticos_db_password = var.agenticos_db_password
  })
}

resource "digitalocean_droplet" "agenticos_droplet" {
  name     = "agenticos-droplet"
  region   = var.do_region
  size     = var.droplet_size
  image    = "ubuntu-24-04-x64"
  vpc_uuid = digitalocean_vpc.agenticos.id

  ssh_keys = [digitalocean_ssh_key.agenticos.fingerprint]

  monitoring = true
  ipv6       = false
  # DO whole-droplet weekly snapshots. Redundant with our pg-backup +
  # viking-backup + Syncthing, but covers the full disk (incl. Paperclip data
  # and Claude Code OAuth state that the app-level backups don't capture).
  backups = true

  tags = ["agenticos", "production"]

  user_data = local.cloud_init

  lifecycle {
    ignore_changes = [
      # Image refresh shouldn't replace the running Droplet.
      image,
      # user_data is ForceNew — any cloud-init template edit would trigger
      # destroy+recreate, losing Paperclip data and Claude Code OAuth.
      # Cloud-init only runs at first boot anyway, so editing the template
      # for FUTURE droplets is fine; the existing Droplet ignores the drift.
      # To force a recreate after a meaningful template change, do it
      # explicitly with `terraform taint digitalocean_droplet.agenticos_droplet`.
      user_data,
      # ssh_keys can also trigger replacement when the keypair fingerprint
      # changes (e.g., key rotation). We handle key rotation by adding the
      # new key to the deploy user via separate automation, not by replacing
      # the Droplet.
      ssh_keys,
    ]
    # Belt-and-suspenders: if we ever DO intentionally trigger replacement
    # (via taint), create the new Droplet before destroying the old. Means
    # we don't lose service if create fails.
    create_before_destroy = true
  }
}
