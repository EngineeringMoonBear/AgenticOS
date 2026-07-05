#!/usr/bin/env bash
###############################################################################
# GOL-38 — migrate root AgenticOS Terraform state → agenticos-tfstate bucket.
#
# Run this ON THE MACHINE THAT HOLDS THE LIVE local state
# (infra/terraform/terraform.tfstate — the operator box that last ran
# `terraform apply`). It is safe and reversible: nothing is created or destroyed
# in DigitalOcean/Cloudflare/Tailscale — this only moves WHERE state is stored,
# and it stops before trusting the remote copy unless `terraform plan` is clean.
#
# Prereqs on this machine:
#   - terraform >= 1.6
#   - op (1Password CLI) signed in to the "Goldberry Grove - Admin" vault
#   - the current infra/terraform/terraform.tfstate present
#
# Usage (from the repo root):
#   bash infra/terraform/migrate-state-gol38.sh
#
# See infra/terraform/MIGRATION-GOL38.md for the full runbook + rollback.
###############################################################################
set -euo pipefail

TF_DIR="infra/terraform"
STATE="$TF_DIR/terraform.tfstate"
BACKUP_DIR="$HOME/agenticos-tfstate-backups"
TS="$(date -u +%Y%m%dT%H%M%SZ)"

command -v terraform >/dev/null || { echo "✗ terraform not found on PATH"; exit 1; }
command -v op >/dev/null        || { echo "✗ op (1Password CLI) not found on PATH"; exit 1; }
[ -f "$TF_DIR/main.tf" ] || { echo "✗ run me from the repo root ($TF_DIR/main.tf not found)"; exit 1; }

if [ ! -f "$STATE" ]; then
  cat >&2 <<EOF
✗ No local state at $STATE.

  This script MUST run where the authoritative local state lives. Migrating from
  a checkout with no state would push an EMPTY state to the bucket and de-manage
  every resource. If your state is elsewhere, run this from that machine/dir.
EOF
  exit 1
fi

echo "▶ 1/4  Backing up local state → $BACKUP_DIR/terraform.tfstate.$TS"
mkdir -p "$BACKUP_DIR"
cp "$STATE" "$BACKUP_DIR/terraform.tfstate.$TS"
echo "  ✓ backup written (nothing is ever deleted)"

echo "▶ 2/4  Uncommenting the backend \"s3\" block in $TF_DIR/main.tf"
cp "$TF_DIR/main.tf" "$TF_DIR/main.tf.pre-gol38"   # reversible: restore this to roll back
# Strip the leading "  # " comment marker from ONLY the backend block lines.
# The block is delimited by the marker comments below.
python3 - "$TF_DIR/main.tf" <<'PY'
import sys
p = sys.argv[1]
lines = open(p).read().splitlines(keepends=True)
out, in_block = [], False
for ln in lines:
    s = ln.lstrip()
    if s.startswith('# backend "s3" {'):
        in_block = True
    if in_block and s.startswith('#'):
        indent = ln[:len(ln) - len(s)]           # preserve indentation
        body = s[2:] if s.startswith('# ') else s[1:]  # strip first "# " / "#"
        out.append(indent + body)
        if s.rstrip() == '# }':                  # end of the backend block
            in_block = False
        continue
    out.append(ln)
open(p, 'w').write(''.join(out))
PY
if ! grep -q 'backend "s3"' "$TF_DIR/main.tf" || grep -q '# *backend "s3"' "$TF_DIR/main.tf"; then
  echo "  ✗ automatic uncomment failed — edit $TF_DIR/main.tf by hand (uncomment the backend \"s3\" block), then re-run." >&2
  echo "    (original preserved at $TF_DIR/main.tf.pre-gol38)" >&2
  exit 1
fi
echo "  ✓ backend block active (original preserved at $TF_DIR/main.tf.pre-gol38)"

echo "▶ 3/4  terraform init -migrate-state (local → agenticos-tfstate)"
export AWS_ACCESS_KEY_ID="$(op read 'op://Goldberry Grove - Admin/AgenticOS Infra/tfstate_spaces_access_key_id')"
export AWS_SECRET_ACCESS_KEY="$(op read 'op://Goldberry Grove - Admin/AgenticOS Infra/tfstate_spaces_secret_key')"
( cd "$TF_DIR" && terraform init -migrate-state -force-copy -input=false )
echo "  ✓ state copied to s3://agenticos-tfstate/foundation-v2/terraform.tfstate"

echo "▶ 4/4  Zero-drift gate: terraform plan (must be 'No changes')"
# Load the provider TF_VARs the plan needs (do_token, cloudflare, tailscale…).
# shellcheck disable=SC1091
source "$TF_DIR/../scripts/load-secrets.sh" 2>/dev/null || source infra/scripts/load-secrets.sh
set +e
( cd "$TF_DIR" && terraform plan -input=false -detailed-exitcode -no-color )
code=$?
set -e
echo
if [ $code -eq 0 ]; then
  cat <<EOF
✅ ZERO DRIFT — "No changes". Migration verified.

  Local state is now inert (Terraform renamed it to terraform.tfstate.backup).
  Remote state: s3://agenticos-tfstate/foundation-v2/terraform.tfstate

  Next: paste this output into GOL-38 so DevOps-Terra can confirm remotely and
  commit the uncommented backend block to main.
EOF
  exit 0
else
  cat >&2 <<EOF
⚠ terraform plan exit code $code (NOT zero-drift). DO NOT trust the remote state.

  Roll back (local backup stays authoritative — nothing was deleted):
    cp $TF_DIR/main.tf.pre-gol38 $TF_DIR/main.tf
    rm -rf $TF_DIR/.terraform $TF_DIR/.terraform.lock.hcl
    cp $BACKUP_DIR/terraform.tfstate.$TS $STATE
    ( cd $TF_DIR && terraform init )

  Then paste the plan diff into GOL-38 so we can resolve the drift before retry.
EOF
  exit $code
fi
