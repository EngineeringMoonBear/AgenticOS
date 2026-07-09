#!/usr/bin/env bash
# infra/scripts/setup-secrets-1password.sh
#
# Creates the 'AgenticOS Infra' item in 1Password with placeholder fields.
# You fill in real values via the 1Password app or CLI afterward.
#
# Vault defaults to 'Goldberry Grove - Admin'. Override with AGENTICOS_OP_VAULT="My Vault".

set -euo pipefail

OP_VAULT="${AGENTICOS_OP_VAULT:-Goldberry Grove - Admin}"
OP_ITEM="AgenticOS Infra"

if ! command -v op >/dev/null 2>&1; then
    echo "1Password CLI not installed." >&2
    echo "  brew install --cask 1password-cli" >&2
    echo "Then enable CLI integration: 1Password app → Settings → Developer → Connect with 1Password CLI" >&2
    exit 1
fi

if ! op account get >/dev/null 2>&1; then
    echo "1Password CLI not signed in." >&2
    echo "  op signin" >&2
    echo "(or with biometric integration enabled, just run any op command to auto-prompt)" >&2
    exit 1
fi

if op item get "$OP_ITEM" --vault "$OP_VAULT" --format=json >/dev/null 2>&1; then
    cat <<EOF
Item "$OP_ITEM" already exists in vault "$OP_VAULT".

To edit fields:
  op item edit "$OP_ITEM" --vault "$OP_VAULT" do_token=NEWVALUE ...
Or open 1Password app and edit visually.
EOF
    exit 0
fi

echo "Creating '$OP_ITEM' in vault '$OP_VAULT'..."

op item create \
    --category="API Credential" \
    --title="$OP_ITEM" \
    --vault="$OP_VAULT" \
    --tags="agenticos,terraform,infra" \
    "do_token[concealed]=PASTE_DIGITALOCEAN_TOKEN_HERE" \
    "tailscale_api_key[concealed]=PASTE_TAILSCALE_API_KEY_HERE" \
    "tailscale_tailnet=PASTE_TAILSCALE_TAILNET_HERE" \
    "cloudflare_api_token[concealed]=PASTE_CLOUDFLARE_API_TOKEN_HERE" \
    "cloudflare_zone_id=PASTE_CLOUDFLARE_ZONE_ID_HERE" \
    "cloudflare_account_id=PASTE_CLOUDFLARE_ACCOUNT_ID_HERE" \
    "anthropic_api_key[concealed]=PASTE_ANTHROPIC_API_KEY_HERE" \
    "deepseek_api_key[concealed]=PASTE_DEEPSEEK_API_KEY_HERE" \
    --url="https://github.com/EngineeringMoonBear/AgenticOS"

cat <<EOF

✓ 1Password item created in vault "$OP_VAULT".

Next: edit each field with real values. Two ways:

  GUI:  open 1Password app, search "AgenticOS Infra", edit each field
  CLI:  op item edit "$OP_ITEM" --vault "$OP_VAULT" do_token="dop_v1_..."

How to generate each token (per infra/README.md §3):

  do_token_scoped      DO Console → API → Tokens → Generate New Token →
                       "Custom Scopes" → grant read+write on EXACTLY these five:
                       droplet, app, ssh_key, vpc, monitoring → Generate. Save to
                       the `Grove Infra` item as `do_token_scoped` (GOL-75). These
                       are the resource types the root Terraform manages; fewer
                       (e.g. droplet+monitoring only) 403s the next plan/apply on
                       the App Platform app, VPC, and SSH key. Do NOT grant full
                       account scope. Verify with infra/scripts/check-auth.sh.
  tailscale_api_key    https://login.tailscale.com/admin/settings/keys
                       (scope: auth_keys:write, 90-day expiry is fine)
  tailscale_tailnet    Your tailnet name from https://login.tailscale.com/admin/general
                       (under "Tailnet name", domain-style like 'goldberrygrove.farm').
                       The REST API accepts this OR the literal '-' (wildcard).
                       Does NOT accept the separate "Tailnet ID" field on that page.
  cloudflare_api_token Cloudflare → Profile → API Tokens → Custom token
                       (DNS:Edit + Access:Edit + Tunnel:Edit on gatheringatthegrove.com)
  cloudflare_zone_id   Cloudflare zone Overview page → sidebar
  cloudflare_account_id Same page, sidebar
  anthropic_api_key    https://console.anthropic.com/settings/keys
  deepseek_api_key     https://platform.deepseek.com/api_keys

Once filled in, verify the loader works:
  source infra/scripts/load-secrets.sh
  env | grep ^TF_VAR_   # should show all six (values hidden in real shells)
EOF
