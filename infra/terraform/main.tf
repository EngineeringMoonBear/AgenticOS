terraform {
  required_version = ">= 1.6.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.40"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.40"
    }
    tailscale = {
      source  = "tailscale/tailscale"
      version = "~> 0.17"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Default: local state. To move state to DigitalOcean Spaces (S3-compatible),
  # uncomment the block below, fill in the bucket details, and run:
  #   terraform init -migrate-state
  # When you uncomment this, also bump required_version above to ">= 1.10.0" —
  # use_lockfile (S3-native locking) needs Terraform >= 1.10. Migration = GOL-38.
  #
  # backend "s3" {
  #   endpoint                    = "https://nyc3.digitaloceanspaces.com"
  #   region                      = "us-east-1"        # required, ignored by Spaces
  #   bucket                      = "agenticos-tfstate"
  #   key                         = "foundation-v2/terraform.tfstate"
  #   skip_credentials_validation = true
  #   skip_metadata_api_check     = true
  #   skip_region_validation      = true
  #   skip_requesting_account_id  = true # DO Spaces has no STS; newer TF needs this
  #   use_lockfile                = true # S3-native state locking (GOL-40). DO
  #                                      # Spaces conditional writes verified: a
  #                                      # 2nd concurrent writer gets HTTP 412.
  # }
}

provider "digitalocean" {
  token = var.do_token
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

provider "tailscale" {
  api_key = var.tailscale_api_key
  tailnet = var.tailscale_tailnet
}
