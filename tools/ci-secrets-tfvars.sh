#!/usr/bin/env bash
# ci-secrets-tfvars.sh — emit TF_VAR_ci_secrets JSON from ci-secrets.yaml (GOL-342)
#
# The Terraform path (infra/terraform/github-ci-secrets.tf) declares AgenticOS's
# Actions secrets as a `for_each` over var.ci_secrets = map(SECRET_NAME => value).
# This helper builds that JSON map from the SAME shared manifest so the mapping
# lives in exactly one place — no value duplication between the script and TF.
# Only NON-gated rows for the target repo are emitted (gated rows would 403).
#
# USAGE
#   export TF_VAR_ci_secrets="$(tools/ci-secrets-tfvars.sh --repo EngineeringMoonBear/AgenticOS)"
#   terraform -chdir=infra/terraform apply -var manage_github_ci_secrets=true
#
# Secret values are read from 1Password via `op read` and go straight into the
# JSON on stdout — capture it into an env var, never echo it. Requires: op, python3.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="${SCRIPT_DIR}/../infra/ci-secrets.yaml"
REPO_FILTER=""

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO_FILTER="$2"; shift;;
    --repo=*) REPO_FILTER="${1#*=}";;
    --manifest) MANIFEST="$2"; shift;;
    --manifest=*) MANIFEST="${1#*=}";;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
  shift
done
[ -n "$REPO_FILTER" ] || { echo "--repo owner/name is required" >&2; exit 2; }
command -v op >/dev/null || { echo "op not found" >&2; exit 1; }

# Collect NAME=value pairs (gated rows skipped), then JSON-encode with python so
# values are safely escaped. Values never touch argv or logs.
pairs=()
while IFS=$'\t' read -r op_ref repo name gate; do
  [ -z "${name:-}" ] && continue
  if [ -n "${gate:-}" ]; then
    echo "skip (gated) $repo $name: $gate" >&2; continue
  fi
  val=$(op read "$op_ref" </dev/null 2>/dev/null) || { echo "FAIL read $op_ref" >&2; exit 1; }
  pairs+=("$name")
  pairs+=("$val")
done < <(python3 "${SCRIPT_DIR}/_parse-ci-secrets.py" "$MANIFEST" "$REPO_FILTER")

# argv to python is exactly the flat NAME value NAME value ... list.
python3 -c '
import json, sys
flat = sys.argv[1:]
out = {flat[i]: flat[i+1] for i in range(0, len(flat), 2)}
print(json.dumps(out))
' "${pairs[@]}"
