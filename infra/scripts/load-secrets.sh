#!/usr/bin/env bash
# infra/scripts/load-secrets.sh
#
# Loads AgenticOS infra secrets as TF_VAR_* environment variables.
# Tries 1Password CLI first; falls back to ~/.config/agenticos/infra.env.
#
# Usage:
#   source infra/scripts/load-secrets.sh
#   cd infra/terraform && terraform apply
#
# OR via direnv (automatic on cd into infra/terraform):
#   See infra/terraform/.envrc

# This file is meant to be sourced, not executed. Detect that.
# (We don't use 'set -e' because exits would kill the caller's shell.)

_agenticos_secrets_loaded=false

# ---- Tier 1: 1Password CLI ----
_agenticos_load_1password() {
    local op_vault="${AGENTICOS_OP_VAULT:-Goldberry Grove - Admin}"
    local op_item="AgenticOS Infra"

    if ! command -v op >/dev/null 2>&1; then return 1; fi
    if ! op account get >/dev/null 2>&1; then return 1; fi
    if ! op item get "$op_item" --vault "$op_vault" --format=json >/dev/null 2>&1; then
        return 1
    fi

    # Each field in the 1Password item maps to a TF_VAR_* env var.
    export TF_VAR_do_token="$(op read "op://${op_vault}/${op_item}/do_token" 2>/dev/null)"
    export TF_VAR_tailscale_api_key="$(op read "op://${op_vault}/${op_item}/tailscale_api_key" 2>/dev/null)"
    export TF_VAR_tailscale_tailnet="$(op read "op://${op_vault}/${op_item}/tailscale_tailnet" 2>/dev/null)"
    export TF_VAR_cloudflare_api_token="$(op read "op://${op_vault}/${op_item}/cloudflare_api_token" 2>/dev/null)"
    export TF_VAR_cloudflare_zone_id="$(op read "op://${op_vault}/${op_item}/cloudflare_zone_id" 2>/dev/null)"
    export TF_VAR_cloudflare_account_id="$(op read "op://${op_vault}/${op_item}/cloudflare_account_id" 2>/dev/null)"

    # Dashboard Paperclip repoint — only needed for the App Platform dashboard
    # apply (absent for droplet-only operations), so these are NOT in the
    # required-six check below. Empty/missing here surfaces at `terraform apply`
    # as a missing-variable error for the dashboard, which is the right place.
    export TF_VAR_paperclip_company_id="$(op read "op://${op_vault}/${op_item}/paperclip_company_id" 2>/dev/null)"
    export TF_VAR_paperclip_board_key="$(op read "op://${op_vault}/${op_item}/paperclip_board_key" 2>/dev/null)"

    # Sanity check: did we get values for all six?
    local missing=()
    for var in TF_VAR_do_token TF_VAR_tailscale_api_key TF_VAR_tailscale_tailnet \
               TF_VAR_cloudflare_api_token TF_VAR_cloudflare_zone_id TF_VAR_cloudflare_account_id; do
        if [ -z "${!var:-}" ] || [[ "${!var}" == "PASTE_"* ]]; then
            missing+=("${var#TF_VAR_}")
        fi
    done
    if [ ${#missing[@]} -gt 0 ]; then
        echo "⚠ 1Password item '$op_item' exists in vault '$op_vault' but these fields are missing or still placeholders:" >&2
        for m in "${missing[@]}"; do echo "    - $m" >&2; done
        echo "  Edit them: op item edit '$op_item' --vault '$op_vault'" >&2
        return 1
    fi

    echo "✓ Loaded AgenticOS infra secrets from 1Password (vault: $op_vault)" >&2
    _agenticos_secrets_loaded=true
    return 0
}

# ---- Tier 2: ~/.config/agenticos/infra.env ----
_agenticos_load_envfile() {
    local envfile="${AGENTICOS_INFRA_ENV:-$HOME/.config/agenticos/infra.env}"
    if [ ! -f "$envfile" ]; then return 1; fi

    # Refuse to load world-readable secrets files
    local perms
    perms="$(stat -f '%Lp' "$envfile" 2>/dev/null || stat -c '%a' "$envfile" 2>/dev/null || echo "")"
    if [ -n "$perms" ] && [ "$perms" != "600" ] && [ "$perms" != "400" ]; then
        echo "⚠ $envfile has permissions $perms — refusing to load." >&2
        echo "  Run: chmod 600 $envfile" >&2
        return 1
    fi

    set -a
    # shellcheck disable=SC1090
    source "$envfile"
    set +a

    echo "✓ Loaded AgenticOS infra secrets from $envfile" >&2
    _agenticos_secrets_loaded=true
    return 0
}

# ---- Run ----
if _agenticos_load_1password 2>/dev/null; then
    :  # success
elif _agenticos_load_envfile 2>/dev/null; then
    :  # fallback success
else
    cat >&2 <<'EOF'
✗ AgenticOS infra credentials not found.

  Option 1 (recommended) — 1Password:
    bash infra/scripts/setup-secrets-1password.sh
    # then edit each field in 1Password to add real values

  Option 2 — plaintext fallback:
    mkdir -p ~/.config/agenticos
    cp infra/secrets.env.example ~/.config/agenticos/infra.env
    chmod 600 ~/.config/agenticos/infra.env
    # then edit with real values

  See infra/README.md §3 for how to generate each token.
EOF
fi

# Clean up internal funcs from the shell namespace
unset -f _agenticos_load_1password _agenticos_load_envfile
unset _agenticos_secrets_loaded
