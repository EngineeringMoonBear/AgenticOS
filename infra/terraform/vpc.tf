resource "digitalocean_vpc" "agenticos" {
  name   = "agenticos-vpc"
  region = var.do_region
  # ip_range left to default (DO assigns a /20)
}
