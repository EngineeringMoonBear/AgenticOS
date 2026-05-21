locals {
  ssh_public_key_path = pathexpand(var.ssh_public_key_path)
  # If the file doesn't exist, file() will error at plan time with a clear path.
  # Generate one with:
  #   ssh-keygen -t ed25519 -f ~/.ssh/agenticos-droplet -C 'agenticos-droplet'
  ssh_public_key = file(pathexpand(var.ssh_public_key_path))
}

resource "digitalocean_ssh_key" "agenticos" {
  name       = "agenticos-droplet-key"
  public_key = local.ssh_public_key
}
