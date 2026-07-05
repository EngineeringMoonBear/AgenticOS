###############################################################################
# AgenticOS State Backend — bootstraps the AgenticOS Terraform state bucket.
#
# GOL-38 (item 2 of GOL-34 "Protect Terraform state"): the root AgenticOS
# Terraform (infra/terraform/) currently keeps state as a LOCAL file on the
# operator's machine. A lost operator disk = lost state = the droplet / DNS /
# tunnel / App Platform become un-managed = outage risk. This module fixes that
# by creating a SEPARATE, VERSIONED Spaces bucket to hold that state remotely.
#
# Why a SEPARATE bucket (agenticos-tfstate) and NOT grove-tf-state?
#   Blast-radius isolation + least privilege. AgenticOS (the Paperclip platform)
#   and the Grove businesses are different failure domains. A key or lifecycle
#   mistake on one estate must not be able to touch the other's state. The
#   bucket-scoped key created below can read/write ONLY agenticos-tfstate.
#
# What this manages:
#   - The Spaces bucket `agenticos-tfstate` (versioning + lifecycle enabled).
#   - A bucket-scoped readwrite Spaces access key for that bucket.
#   - Two GitHub Actions secrets on EngineeringMoonBear/AgenticOS:
#       SPACES_ACCESS_KEY_ID, SPACES_SECRET_ACCESS_KEY
#     so any future workflow that runs `terraform` against the S3 backend
#     authenticates cleanly (as AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY).
#
# Apply order:
#   1. state-backend  (this module, ONE TIME)   → creates the state bucket
#   2. root infra/terraform  (migrate-state)     → uses the bucket as backend
#
# Destroy:
#   `prevent_destroy = true` on the bucket means `terraform destroy` will
#   refuse to wipe it. Removing the bucket requires editing this file first,
#   which is the friction we want — destroying agenticos-tfstate invalidates
#   the root AgenticOS state.
###############################################################################

# === Provider configurations ===

provider "digitalocean" {
  token = var.do_token

  # Spaces creds are needed for bucket-level operations (create, refresh,
  # versioning, lifecycle). The DO REST API token can manage Spaces *keys* (via
  # digitalocean_spaces_key below) but NOT *buckets* — those go through the
  # S3-compatible protocol and need S3-style creds. We supply a long-lived
  # account-wide "plumbing" key here; the workflow-facing bucket-scoped key is
  # created in this same apply and pushed to GH secrets. See README
  # "Why two Spaces keys".
  #
  # AgenticOS and the Grove businesses live in the SAME DigitalOcean account
  # (team MoonBear, uuid c4253478…), so the existing account-wide plumbing key
  # in 1Password (GoldberryGrove Infra/spaces_bootstrap_*) is reused here for
  # provider auth. It is operator-only (never surfaced to CI) and is distinct
  # from the bucket-scoped agenticos-tfstate key this module creates. See
  # .env.op + README "Why two Spaces keys".
  spaces_access_id  = var.spaces_bootstrap_access_key_id
  spaces_secret_key = var.spaces_bootstrap_secret_key
}

provider "github" {
  token = var.github_token
  owner = split("/", var.github_secrets_repo)[0]
}

# === The state bucket ===

resource "digitalocean_spaces_bucket" "tf_state" {
  name   = var.bucket_name
  region = var.region
  acl    = "private"

  # State is sacred. Versioning gives point-in-time recovery: a corrupted or
  # racing apply that clobbers the state object leaves the prior version
  # recoverable (DO Spaces retains non-current versions). Non-destructive,
  # in-place change — enabling it never rewrites existing objects, it only
  # starts versioning writes from here forward.
  versioning {
    enabled = true
  }

  # Keep versioning from growing without bound. Non-current state versions are
  # only needed as a short recovery window, and half-finished multipart uploads
  # (e.g. an interrupted `terraform apply`) are pure waste. State objects are
  # tiny (~KBs) so 90 days of history is cheap insurance, not bloat.
  lifecycle_rule {
    id      = "expire-noncurrent-state-versions"
    enabled = true

    noncurrent_version_expiration {
      days = 90
    }

    abort_incomplete_multipart_upload_days = 7
  }

  # Destroying this bucket destroys the remote state of the root AgenticOS
  # Terraform. Don't make it easy.
  lifecycle {
    prevent_destroy = true
  }
}

# === The bucket-scoped access key ===

# Created via the DO REST API (using var.do_token) — outputs an S3-style
# access_key + secret_key scoped to ONLY this bucket. This is the credential
# the root Terraform's S3 backend uses to talk the S3-compatible protocol
# against nyc3.digitaloceanspaces.com. Least privilege: it cannot touch
# grove-tf-state or any other bucket.
resource "digitalocean_spaces_key" "tf_state_rw" {
  name = "${var.bucket_name}-rw"

  grant {
    bucket     = digitalocean_spaces_bucket.tf_state.name
    permission = "readwrite"
  }
}

# === Push to GitHub Actions secrets on AgenticOS ===

locals {
  github_repo_name = split("/", var.github_secrets_repo)[1]

  # Named to match the AWS_* env convention the Terraform S3 backend consumes,
  # so a future CI job needs only:
  #   env:
  #     AWS_ACCESS_KEY_ID:     ${{ secrets.SPACES_ACCESS_KEY_ID }}
  #     AWS_SECRET_ACCESS_KEY: ${{ secrets.SPACES_SECRET_ACCESS_KEY }}
  gh_secrets = {
    SPACES_ACCESS_KEY_ID     = digitalocean_spaces_key.tf_state_rw.access_key
    SPACES_SECRET_ACCESS_KEY = digitalocean_spaces_key.tf_state_rw.secret_key
  }
}

resource "github_actions_secret" "state_backend" {
  # Gated: pushing Actions secrets needs a github_token with Actions:Secrets
  # write on var.github_secrets_repo. The AgenticOS Infra github_token is
  # Contents/PR-scoped (no secrets write), so bootstrap runs with this OFF and
  # the bucket-scoped key is stored in 1Password (AgenticOS Infra /
  # tfstate_spaces_*) instead. Flip to true once a secrets-scoped token is
  # available to converge the two GH secrets. AgenticOS runs no Terraform in CI
  # today, so these secrets are a forward-looking convenience, not a dependency
  # of the state migration.
  for_each = var.manage_github_secrets ? local.gh_secrets : {}

  repository  = local.github_repo_name
  secret_name = each.key
  # The github provider deprecated `plaintext_value` in 6.x — `value` is the
  # new name; behavior is identical (encrypted at rest by GH, masked in logs).
  value = each.value
}
