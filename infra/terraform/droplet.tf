locals {
  cloud_init = templatefile("${path.module}/../cloud-init/droplet-bootstrap.yaml.tpl", {
    ts_authkey    = tailscale_tailnet_key.droplet.key
    github_repo   = var.github_repo
    deploy_pubkey = local.ssh_public_key
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
  backups    = false

  tags = ["agenticos", "production"]

  user_data = local.cloud_init

  lifecycle {
    ignore_changes = [
      # Image refresh shouldn't replace the running Droplet.
      image,
      # user_data is ForceNew — any cloud-init template edit would trigger
      # destroy+recreate, losing Honcho data and Claude Code OAuth.
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
