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

  # Replace if the cloud-init template changes meaningfully.
  lifecycle {
    ignore_changes = [
      image, # don't replace on image refreshes
    ]
  }
}
