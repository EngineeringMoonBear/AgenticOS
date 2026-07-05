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
#   - jq (used to validate the local state before touching anything)
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
PRE_TF="$TF_DIR/main.tf.pre-gol38"
BACKUP_DIR="$HOME/agenticos-tfstate-backups"
TS="$(date -u +%Y%m%dT%H%M%SZ)"

command -v terraform >/dev/null || { echo "✗ terraform not found on PATH"; exit 1; }
command -v jq >/dev/null        || { echo "✗ jq not found on PATH (needed to validate local state)"; exit 1; }
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

echo "▶ 1/5  Validating local state ($STATE)"
# Guardrail: a truncated / half-written / non-JSON state file would silently
# migrate garbage. Fail loud BEFORE we copy anything to the remote bucket.
if ! jq empty "$STATE" 2>/dev/null; then
  echo "  ✗ $STATE is not valid JSON — refusing to migrate a corrupt state file." >&2
  exit 1
fi
# Count managed resource INSTANCES (matches `terraform state list` semantics).
PRE_COUNT="$(jq '[.resources[].instances[]] | length' "$STATE")"
if ! [[ "$PRE_COUNT" =~ ^[0-9]+$ ]] || [ "$PRE_COUNT" -eq 0 ]; then
  cat >&2 <<EOF
  ✗ Local state reports $PRE_COUNT managed resource instances.

  Migrating an empty state would push a de-managed state to the bucket. If this
  really is the authoritative box, investigate before proceeding — do NOT retry
  blindly.
EOF
  exit 1
fi
echo "  ✓ valid JSON, $PRE_COUNT managed resource instance(s) — this is the baseline we assert against post-migration"

echo "▶ 2/5  Uncommenting the backend \"s3\" block in $TF_DIR/main.tf"
# Retry-safe: only snapshot the ORIGINAL (commented) main.tf once. On a retry
# after a partial run, main.tf may already be uncommented; overwriting the
# snapshot would destroy the rollback artifact (must-fix: guard the pre-GOL38
# backup).
if [ ! -f "$PRE_TF" ]; then
  cp "$TF_DIR/main.tf" "$PRE_TF"
  echo "  ✓ original main.tf snapshotted → $PRE_TF (rollback artifact)"
else
  echo "  ✓ $PRE_TF already exists — preserving the original snapshot (retry-safe)"
fi
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
  echo "    (original preserved at $PRE_TF)" >&2
  exit 1
fi
# Sentinel check: the sed/python uncomment is comment-marker driven, so a shifted
# marker or a stray "#" would produce syntactically-broken HCL. `terraform
# validate` (backend disabled so it doesn't reach Spaces) catches that before we
# migrate anything.
if ! ( cd "$TF_DIR" && terraform init -backend=false -input=false >/dev/null && terraform validate -no-color ); then
  echo "  ✗ terraform validate failed after uncomment — the backend block is malformed." >&2
  echo "    Roll back with: cp $PRE_TF $TF_DIR/main.tf ; rm -rf $TF_DIR/.terraform" >&2
  exit 1
fi
echo "  ✓ backend block active and valid (original preserved at $PRE_TF)"

echo "▶ 3/5  terraform init -migrate-state (local → agenticos-tfstate)"
export AWS_ACCESS_KEY_ID="$(op read 'op://Goldberry Grove - Admin/AgenticOS Infra/tfstate_spaces_access_key_id')"
export AWS_SECRET_ACCESS_KEY="$(op read 'op://Goldberry Grove - Admin/AgenticOS Infra/tfstate_spaces_secret_key')"
( cd "$TF_DIR" && terraform init -migrate-state -force-copy -input=false )
echo "  ✓ state copied to s3://agenticos-tfstate/foundation-v2/terraform.tfstate"

echo "▶ 4/5  Post-migration assertion: remote resource count == local baseline"
# Reads the REMOTE state now that the backend is active. If the copy dropped or
# duplicated resources, the counts diverge — abort before trusting the remote.
REMOTE_COUNT="$( ( cd "$TF_DIR" && terraform state list ) | grep -c . || true )"
if [ "$REMOTE_COUNT" != "$PRE_COUNT" ]; then
  cat >&2 <<EOF
  ✗ Count mismatch: local baseline=$PRE_COUNT, remote=$REMOTE_COUNT.

  The remote copy does not match what we started with. DO NOT trust it. Roll back
  (local backup is still authoritative — nothing was deleted):
    cp $PRE_TF $TF_DIR/main.tf
    rm -rf $TF_DIR/.terraform $TF_DIR/.terraform.lock.hcl
    cp $BACKUP_DIR/terraform.tfstate.$TS $STATE
    ( cd $TF_DIR && terraform init )
EOF
  exit 1
fi
echo "  ✓ remote state has $REMOTE_COUNT resource instance(s) — matches local baseline"

echo "▶ 5/5  Zero-drift gate: terraform plan (must be 'No changes')"
# Load the provider TF_VARs the plan needs (do_token, cloudflare, tailscale…).
# shellcheck disable=SC1091
source "$TF_DIR/../scripts/load-secrets.sh" 2>/dev/null || source infra/scripts/load-secrets.sh
set +e
( cd "$TF_DIR" && terraform plan -input=false -detailed-exitcode -no-color )
code=$?
set -e
echo
# `terraform plan -detailed-exitcode`: 0 = no changes, 2 = drift (succeeded but
# diffs), 1 = plan ERROR (bad creds/config). Treat 1 and 2 differently: drift is
# a state problem to reconcile; an error means the plan never ran.
if [ $code -eq 0 ]; then
  cat <<EOF
✅ ZERO DRIFT — "No changes". Migration verified.

  Local state is now inert (Terraform renamed it to terraform.tfstate.backup).
  Remote state: s3://agenticos-tfstate/foundation-v2/terraform.tfstate

  Next: paste this output into GOL-38 so DevOps-Terra can confirm remotely and
  commit the uncommented backend block to main.
EOF
  exit 0
elif [ $code -eq 2 ]; then
  cat >&2 <<EOF
⚠ DRIFT — terraform plan succeeded but shows changes (exit 2). The remote state
  loaded fine, but config != reality. DO NOT commit the backend block yet.

  Roll back (local backup stays authoritative — nothing was deleted):
    cp $PRE_TF $TF_DIR/main.tf
    rm -rf $TF_DIR/.terraform $TF_DIR/.terraform.lock.hcl
    cp $BACKUP_DIR/terraform.tfstate.$TS $STATE
    ( cd $TF_DIR && terraform init )

  Then paste the plan diff into GOL-38 so we can resolve the drift before retry.
EOF
  exit 2
else
  cat >&2 <<EOF
✗ PLAN ERROR — terraform plan failed to run (exit $code), e.g. missing/invalid
  provider credentials or a config error. This is NOT a drift signal; the remote
  state may be fine. Fix the error (check load-secrets.sh / TF_VAR_* env) and
  re-run the plan:
    ( cd $TF_DIR && terraform plan -input=false -detailed-exitcode )

  If you need to fully roll back the backend change:
    cp $PRE_TF $TF_DIR/main.tf
    rm -rf $TF_DIR/.terraform $TF_DIR/.terraform.lock.hcl
    cp $BACKUP_DIR/terraform.tfstate.$TS $STATE
    ( cd $TF_DIR && terraform init )
EOF
  exit $code
fi
