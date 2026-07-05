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

  # Default: local state. The versioned remote bucket `agenticos-tfstate` is
  # already bootstrapped (see state-backend/ + GOL-38). To migrate this root
  # state onto it, DO NOT hand-edit blindly — follow the reversible runbook:
  #   infra/terraform/MIGRATION-GOL38.md   (or: bash infra/terraform/migrate-state-gol38.sh)
  # It backs up local state, uncomments the block below, runs
  # `terraform init -migrate-state`, and gates on a zero-drift `terraform plan`.
  # Kept commented until that migration is executed + verified (guardrail:
  # local state stays authoritative until the zero-diff plan passes).
  #
  # backend "s3" {
  #   endpoint                    = "https://nyc3.digitaloceanspaces.com"
  #   region                      = "us-east-1"        # required, ignored by Spaces
  #   bucket                      = "agenticos-tfstate"
  #   key                         = "foundation-v2/terraform.tfstate"
  #   skip_credentials_validation = true
  #   skip_metadata_api_check     = true
  #   skip_region_validation      = true
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
