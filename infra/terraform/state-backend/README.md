# AgenticOS State Backend

Bootstraps `agenticos-tfstate` — the versioned DigitalOcean Spaces bucket that
holds the **remote** Terraform state for the root AgenticOS infra
(`infra/terraform/`). Ships GOL-38 (item 2 of GOL-34, "Protect Terraform
state").

## Why this exists

The root AgenticOS Terraform keeps state as a **local file** on the operator's
machine. That is the single highest-risk gap in the estate: a lost operator disk
= lost state = the droplet, DNS, Cloudflare tunnel, App Platform app, and
Tailscale config all become un-managed. Recovering means `terraform import`-ing
every resource by hand — during an outage.

This module moves that state into a versioned bucket so it survives any single
machine, and so two operators can never race on a local copy.

### Why a SEPARATE bucket (not `grove-tf-state`)

Blast-radius isolation + least privilege. AgenticOS (the Paperclip platform) and
the Grove businesses are different failure domains. The bucket-scoped key this
module creates can read/write **only** `agenticos-tfstate` — a lifecycle or key
mistake on one estate cannot reach the other's state.

## Why two Spaces keys

DigitalOcean Spaces speaks the **S3 protocol**, not the DO REST API. So:

- **Bucket-level operations** (create bucket, set versioning/lifecycle) require
  **S3-style credentials** on the provider (`spaces_access_id` /
  `spaces_secret_key`). That is the long-lived, account-wide **"plumbing" key**.
  It is operator-only and never surfaced to CI. Because AgenticOS shares the
  Grove DO account (team **MoonBear**), the existing account-wide plumbing key
  in 1Password (`GoldberryGrove Infra/spaces_bootstrap_*`) is reused rather than
  minting a redundant second all-buckets key.
- **The key this module CREATES** (`agenticos-tfstate-rw`) is **bucket-scoped**
  to `agenticos-tfstate` only. That is the least-privilege credential the root
  backend + any future CI consume.

  Its durable home is **1Password** (`AgenticOS Infra / tfstate_spaces_access_key_id` +
  `tfstate_spaces_secret_key`). Optionally it is also pushed to GitHub Actions
  secrets `SPACES_ACCESS_KEY_ID` / `SPACES_SECRET_ACCESS_KEY` when
  `manage_github_secrets = true` — that path needs a `github_token` with
  Actions:Secrets write on the repo, which the current AgenticOS Infra token
  lacks, so it defaults **off**. AgenticOS runs no Terraform in CI today, so the
  GH secrets are a forward-looking convenience, not a dependency of the state
  migration.

## Apply (one time)

Requires `op` (1Password CLI) authenticated to the `Goldberry Grove - Admin`
vault, plus `terraform >= 1.6`.

```bash
cd infra/terraform/state-backend
op run --env-file=.env.op -- terraform init
op run --env-file=.env.op -- terraform apply
```

This creates the bucket (versioning + lifecycle), the bucket-scoped key, and the
two GitHub Actions secrets. Its own state is a small **local** file
(`terraform.tfstate`, git-ignored) — intentionally not remote, to avoid the
circular dependency of storing the state-bucket's state inside the state bucket.

Verify:

```bash
# Bucket exists + versioning Enabled (read-only):
op run --env-file=.env.op -- terraform output
```

## Then: migrate the root state

Once the bucket exists, migrate the root AgenticOS state onto it — see the
reversible runbook in
[`../MIGRATION-GOL38.md`](../MIGRATION-GOL38.md). In short: back up the local
state off-box, uncomment the `backend "s3"` block in `../main.tf`,
`terraform init -migrate-state`, then confirm `terraform plan` shows
**"No changes"** before trusting the remote copy.

## Destroy

`prevent_destroy = true` guards the bucket — `terraform destroy` refuses to wipe
it. Removing the bucket requires editing `main.tf` first (deliberate friction),
because destroying `agenticos-tfstate` invalidates the root AgenticOS state.
