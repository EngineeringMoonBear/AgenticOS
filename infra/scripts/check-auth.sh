#!/usr/bin/env bash
# infra/scripts/check-auth.sh
#
# Verifies all six AgenticOS infra credentials work against their APIs,
# plus the two manual prerequisites (Cloudflare Google IdP, Tailscale
# tag:agenticos-droplet in tagOwners).
#
# Run before `terraform apply` to catch credential/scope/prereq issues
# with a clear error rather than a half-provisioned stack.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/load-secrets.sh"

# Bail if loader didn't get all six.
for v in TF_VAR_do_token TF_VAR_tailscale_api_key TF_VAR_tailscale_tailnet \
         TF_VAR_cloudflare_api_token TF_VAR_cloudflare_zone_id TF_VAR_cloudflare_account_id; do
    if [ -z "${!v:-}" ] || [[ "${!v}" == PASTE_* ]]; then
        echo "✗ $v is empty or placeholder." >&2
        exit 1
    fi
done

FAILED=0
WARN=0

BODY="$(mktemp)"
trap 'rm -f "$BODY"' EXIT
HTTP_CODE="000"

# http_get URL "Header1: value1" "Header2: value2" ...
# Writes body to $BODY, sets $HTTP_CODE.
http_get() {
    local url="$1"; shift
    local args=()
    for h in "$@"; do args+=(-H "$h"); done
    HTTP_CODE="$(curl -sS -o "$BODY" -w "%{http_code}" "${args[@]}" "$url" 2>/dev/null || echo 000)"
}

green()  { printf "\033[32m%s\033[0m\n" "$*"; }
red()    { printf "\033[31m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }

heading() {
    echo
    echo "═══════════════════════════════════════════════════════════════"
    echo " $1"
    echo "═══════════════════════════════════════════════════════════════"
}

# ───── DigitalOcean ─────
heading "DigitalOcean"
http_get https://api.digitalocean.com/v2/account "Authorization: Bearer $TF_VAR_do_token"
if [ "$HTTP_CODE" = "200" ]; then
    email="$(jq -r '.account.email // "?"' < "$BODY")"
    status="$(jq -r '.account.status // "?"' < "$BODY")"
    droplet_limit="$(jq -r '.account.droplet_limit // "?"' < "$BODY")"
    green "✓ DO API auth ok"
    echo "    account:        $email"
    echo "    status:         $status"
    echo "    droplet limit:  $droplet_limit"
else
    red "✗ DO API returned HTTP $HTTP_CODE"
    head -5 "$BODY"
    FAILED=$((FAILED+1))
fi

# ───── Tailscale ─────
heading "Tailscale"
http_get "https://api.tailscale.com/api/v2/tailnet/$TF_VAR_tailscale_tailnet/devices" \
    "Authorization: Bearer $TF_VAR_tailscale_api_key"
if [ "$HTTP_CODE" = "200" ]; then
    count="$(jq '.devices | length' < "$BODY")"
    green "✓ Tailscale API auth ok"
    echo "    tailnet:        $TF_VAR_tailscale_tailnet"
    echo "    devices:        $count"
else
    red "✗ Tailscale API returned HTTP $HTTP_CODE"
    head -5 "$BODY"
    FAILED=$((FAILED+1))
fi

# ACL — needs tag:agenticos-droplet in tagOwners
http_get "https://api.tailscale.com/api/v2/tailnet/$TF_VAR_tailscale_tailnet/acl" \
    "Authorization: Bearer $TF_VAR_tailscale_api_key" \
    "Accept: application/json"
if [ "$HTTP_CODE" = "200" ]; then
    if grep -q '"tag:agenticos-droplet"' "$BODY"; then
        green "✓ Tailscale ACL has 'tag:agenticos-droplet' in tagOwners"
    else
        yellow "⚠ Tailscale ACL is MISSING 'tag:agenticos-droplet' in tagOwners"
        echo "    Terraform apply will fail at the tailnet auth key creation."
        echo "    Fix: open https://login.tailscale.com/admin/acls — add to your ACL's tagOwners block:"
        echo "      \"tagOwners\": {"
        echo "        \"tag:agenticos-droplet\": [\"autogroup:admin\"]"
        echo "      }"
        WARN=$((WARN+1))
    fi
else
    yellow "⚠ Couldn't read Tailscale ACL (HTTP $HTTP_CODE)"
    WARN=$((WARN+1))
fi

# ───── Cloudflare ─────
heading "Cloudflare"
http_get https://api.cloudflare.com/client/v4/user/tokens/verify \
    "Authorization: Bearer $TF_VAR_cloudflare_api_token"
if [ "$HTTP_CODE" = "200" ]; then
    status="$(jq -r '.result.status' < "$BODY")"
    green "✓ Cloudflare token verify ok (status: $status)"
else
    # /user/tokens/verify requires User:User Details:Read scope which scoped
    # tokens often don't have. Not a hard failure — the zone+account checks
    # below are what actually matter for terraform apply.
    yellow "ⓘ Cloudflare /user/tokens/verify returned HTTP $HTTP_CODE — this is informational only"
    echo "    (requires User:User Details:Read scope which scoped tokens often skip)"
    echo "    The zone + account checks below are what actually matter."
fi

http_get "https://api.cloudflare.com/client/v4/zones/$TF_VAR_cloudflare_zone_id" \
    "Authorization: Bearer $TF_VAR_cloudflare_api_token"
if [ "$HTTP_CODE" = "200" ]; then
    name="$(jq -r '.result.name' < "$BODY")"
    if [ "$name" = "gatheringatthegrove.com" ]; then
        green "✓ Cloudflare zone READ access ok — $name"

        # Zone READ != Zone DNS EDIT. Probe write by creating + deleting a TXT record.
        # Without this check we get a green check-auth followed by an exploding
        # terraform apply (see commit history for the actual incident).
        PROBE_NAME="_agenticos-permission-probe"
        http_get "https://api.cloudflare.com/client/v4/zones/$TF_VAR_cloudflare_zone_id/dns_records" \
            "Authorization: Bearer $TF_VAR_cloudflare_api_token" \
            "Content-Type: application/json"
        # http_get is GET; do POST manually for create-then-delete
        write_resp="$(curl -sS -X POST \
            -H "Authorization: Bearer $TF_VAR_cloudflare_api_token" \
            -H "Content-Type: application/json" \
            -d "{\"type\":\"TXT\",\"name\":\"$PROBE_NAME\",\"content\":\"agenticos-probe\",\"ttl\":120}" \
            "https://api.cloudflare.com/client/v4/zones/$TF_VAR_cloudflare_zone_id/dns_records")"
        if echo "$write_resp" | grep -q '"success":true'; then
            green "✓ Cloudflare zone DNS:Edit ok (write probe succeeded)"
            probe_id="$(echo "$write_resp" | jq -r '.result.id')"
            curl -sS -X DELETE \
                -H "Authorization: Bearer $TF_VAR_cloudflare_api_token" \
                "https://api.cloudflare.com/client/v4/zones/$TF_VAR_cloudflare_zone_id/dns_records/$probe_id" \
                > /dev/null
        else
            red "✗ Cloudflare zone DNS:Edit missing — write probe failed"
            echo "$write_resp" | head -3
            echo "    Fix: token needs Zone:DNS:Edit, not just Zone:Read. Recreate at"
            echo "    https://dash.cloudflare.com/profile/api-tokens"
            FAILED=$((FAILED+1))
        fi
    else
        yellow "⚠ Zone name is '$name' (expected gatheringatthegrove.com)"
        WARN=$((WARN+1))
    fi
else
    red "✗ Cloudflare zone access returned HTTP $HTTP_CODE"
    head -5 "$BODY"
    FAILED=$((FAILED+1))
fi

http_get "https://api.cloudflare.com/client/v4/accounts/$TF_VAR_cloudflare_account_id" \
    "Authorization: Bearer $TF_VAR_cloudflare_api_token"
if [ "$HTTP_CODE" = "200" ]; then
    name="$(jq -r '.result.name' < "$BODY")"
    green "✓ Cloudflare account access ok — $name"
else
    red "✗ Cloudflare account access returned HTTP $HTTP_CODE (account_id wrong, or token missing account scopes)"
    head -5 "$BODY"
    FAILED=$((FAILED+1))
fi

http_get "https://api.cloudflare.com/client/v4/accounts/$TF_VAR_cloudflare_account_id/access/identity_providers" \
    "Authorization: Bearer $TF_VAR_cloudflare_api_token"
if [ "$HTTP_CODE" = "200" ]; then
    google_id="$(jq -r '.result[]? | select(.name == "Google") | .id' < "$BODY")"
    if [ -n "$google_id" ]; then
        green "✓ Cloudflare 'Google' IdP exists (id: $google_id)"
    else
        yellow "⚠ Cloudflare 'Google' IdP is MISSING"
        echo "    Terraform apply will fail at cloudflare-access.tf data lookup."
        echo "    Fix: Cloudflare Zero Trust → Settings → Authentication → Login methods → Add → Google"
        echo "    Name it exactly 'Google'."
        existing="$(jq -r '.result[]? | "      - \(.name) (\(.type))"' < "$BODY")"
        if [ -n "$existing" ]; then
            echo "    Currently configured IdPs:"
            echo "$existing"
        else
            echo "    No IdPs configured yet."
        fi
        WARN=$((WARN+1))
    fi
else
    yellow "⚠ Couldn't list Cloudflare IdPs (HTTP $HTTP_CODE) — token may lack Account:Access:Apps and Policies:Edit"
    WARN=$((WARN+1))
fi

echo
echo "═══════════════════════════════════════════════════════════════"
if [ "$FAILED" -gt 0 ]; then
    red "FAIL: $FAILED hard failure(s), $WARN warning(s). Fix before terraform apply."
    exit 1
elif [ "$WARN" -gt 0 ]; then
    yellow "PARTIAL: 0 failures, $WARN warning(s). Address warnings before terraform apply."
    exit 2
else
    green "ALL GREEN: 0 failures, 0 warnings. Ready: cd infra/terraform && terraform apply"
    exit 0
fi
