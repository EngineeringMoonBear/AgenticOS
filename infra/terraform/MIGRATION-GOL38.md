# GOL-38 — Migrate root AgenticOS state → `agenticos-tfstate` (reversible runbook)

Moves the **root** AgenticOS Terraform state (`infra/terraform/`) off a local
file and into the versioned Spaces bucket `agenticos-tfstate` bootstrapped by
[`state-backend/`](state-backend/). This is item 2 of GOL-34 ("Protect
Terraform state") — the highest-risk item, because today a lost operator disk =
lost state = outage.

## Status of prerequisites (done by DevOps-Terra, GOL-38)

- ✅ Bucket `agenticos-tfstate` created — **versioning Enabled**, lifecycle
  (noncurrent-version expire 90d, abort-incomplete-multipart 7d), `private`,
  region `nyc3`. `prevent_destroy = true`.
- ✅ Bucket-scoped `readwrite` key `agenticos-tfstate-rw` created (scoped to
  ONLY this bucket) and stored in 1Password:
  `AgenticOS Infra / tfstate_spaces_access_key_id` + `tfstate_spaces_secret_key`.
- ✅ Backend values wired into `main.tf` (commented until migration).

## Why this step must run where the live state is

The `terraform init -migrate-state` command copies the **current local state**
into the bucket. It must be run in the working copy that holds the authoritative
`terraform.tfstate` (the operator machine that last ran `terraform apply`).
Running it from a checkout with **no** local state would push an EMPTY state to
the bucket and de-manage every resource — the failure this ticket exists to
prevent. Hence this one step is handed to the operator; everything else is
already done.

Requirements on that machine: `terraform >= 1.6`, `op` (1Password CLI)
authenticated to the `Goldberry Grove - Admin` vault, and the current
`infra/terraform/terraform.tfstate` present.

## The safe path (one script)

From the repo root on the machine that holds the live state:

```bash
bash infra/terraform/migrate-state-gol38.sh
```

That script performs, in order:

1. **Backup** the current `terraform.tfstate` to a timestamped off-tree copy
   (`~/agenticos-tfstate-backups/terraform.tfstate.<UTC-timestamp>`) — nothing is
   deleted, ever.
2. **Uncomment** the `backend "s3"` block in `main.tf` (writes `main.tf.pre-gol38`
   first so the edit is reversible).
3. `terraform init -migrate-state` — Terraform copies local → remote and prompts
   `yes` to confirm.
4. `terraform plan -detailed-exitcode` — the **zero-drift gate**. Exit code `0`
   means "No changes" (every resource mapping survived). Any other code aborts
   the script and tells you how to roll back; the remote state is only trusted
   once this passes.

Then **paste the tail of the script output** (the `terraform plan` result) into
[GOL-38](/GOL/issues/GOL-38). DevOps-Terra will independently verify from the
control plane that the object landed in `agenticos-tfstate` and that
`terraform state list` against the remote backend is non-empty, then close the
item and commit the uncommented backend block to `main`.

## Manual equivalent (if you prefer to run it by hand)

```bash
cd infra/terraform

# 1. Back up (off-tree, timestamped)
mkdir -p ~/agenticos-tfstate-backups
cp terraform.tfstate ~/agenticos-tfstate-backups/terraform.tfstate.$(date -u +%Y%m%dT%H%M%SZ)

# 2. Uncomment the `backend "s3"` block in main.tf (bucket agenticos-tfstate,
#    key foundation-v2/terraform.tfstate). Keep main.tf.pre-gol38 as a copy.

# 3. Point the S3 backend at the bucket-scoped key + migrate.
export AWS_ACCESS_KEY_ID=$(op read "op://Goldberry Grove - Admin/AgenticOS Infra/tfstate_spaces_access_key_id")
export AWS_SECRET_ACCESS_KEY=$(op read "op://Goldberry Grove - Admin/AgenticOS Infra/tfstate_spaces_secret_key")
terraform init -migrate-state          # answer "yes" to copy local → remote

# 4. Zero-drift gate — MUST print "No changes".
#    Load the provider creds (do_token, cloudflare, tailscale…) so plan can run:
source ../scripts/load-secrets.sh
terraform plan
```

## Rollback (until the zero-diff plan passes, the local backup is authoritative)

Nothing is destructive up to the plan gate. To roll back:

```bash
cd infra/terraform
cp main.tf.pre-gol38 main.tf                       # re-comment the backend block
rm -rf .terraform .terraform.lock.hcl              # drop the remote backend init
cp ~/agenticos-tfstate-backups/terraform.tfstate.<TS> terraform.tfstate   # restore
terraform init                                     # back to local backend
```

The remote object in `agenticos-tfstate` is harmless if abandoned (versioned;
can be deleted later). No AgenticOS resource is ever created/destroyed by this
migration — it only moves where state is stored.

## Done when

`agenticos-tfstate` holds `foundation-v2/terraform.tfstate`, `terraform plan`
shows **"No changes"**, the local file is inert (renamed to
`terraform.tfstate.backup` by Terraform), and the uncommented backend block is
merged to `main`.
