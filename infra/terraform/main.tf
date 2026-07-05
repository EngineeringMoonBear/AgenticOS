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

  # Remote state — ACTIVE. State lives in the versioned `agenticos-tfstate`
  # Spaces bucket (see state-backend/ + GOL-38). The migration has been executed
  # and verified (zero real drift: 0 add / 0 destroy; only the known cosmetic
  # dashboard SECRET-env re-render remains), so this block is now uncommented.
  # Reversible runbook + script preserved at infra/terraform/MIGRATION-GOL38.md
  # and migrate-state-gol38.sh for reference / disaster recovery.
  backend "s3" {
    # DigitalOcean Spaces speaks the S3-compatible protocol; this is NOT AWS.
    # The four skip_* flags below (esp. skip_requesting_account_id) stop the
    # backend from calling real AWS STS/IAM to look up an account id — without
    # them, terraform hits AWS and fails with STS 403 InvalidClientTokenId.
    endpoints                   = { s3 = "https://nyc3.digitaloceanspaces.com" }
    region                      = "us-east-1" # required by the backend, ignored by Spaces
    bucket                      = "agenticos-tfstate"
    key                         = "foundation-v2/terraform.tfstate"
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    # Newer AWS SDKs (provider >= 5.x) send integrity checksums Spaces returns
    # 501 Not Implemented for; without this, init/plan fail on every read/write.
    skip_s3_checksum = true
    # NOTE: S3-native state locking via `use_lockfile = true` is deferred to
    # GOL-40 — it requires Terraform >= 1.10 and a `required_version` bump to
    # match. This migration (GOL-38) was executed/verified on TF 1.9.8 without
    # it; GOL-40 adds locking + the version bump as a follow-up. Concurrency is
    # meanwhile guarded by CI `concurrency:` groups (GOL-39).
  }
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
