# GitHub Actions secrets on the AgenticOS repo, managed by Terraform (GOL-342).
#
# GOL-252 seeded this as a single gated `github_actions_secret` for
# DO_MONITORING_TOKEN (the Tier 2A rightsize advisor). GOL-342 generalises it to
# a declarative `for_each` over the `ci_secrets` map so *any* number of Actions
# secrets are declared in one place with drift detection. Values are never
# committed — they are injected at apply time from 1Password via TF_VAR (see
# `op run` recipe below), exactly like agenticos_db_password / openviking_root_api_key.
#
# The paired, repo-agnostic runner for one-offs / other repos is
# ../../tools/sync-ci-secrets.sh reading ../ci-secrets.yaml (op_ref → repo → name).
# Terraform is the source of truth for AgenticOS's own secrets; the script covers
# repos where a scheduled Action or ad-hoc `op read | gh secret set` is simpler.
#
# ── GOVERNANCE GATE — still CLOSED for AgenticOS (verified 2026-07-13, GOL-342)
# Pushing Actions secrets requires a github_token with Actions:Secrets *WRITE* on
# the repo. VERIFIED by real API calls on 2026-07-13:
#   • Shared GitHub App (broker) token:  GET actions/secrets/public-key = 200 (READ)
#                                         PUT actions/secrets/<name>    = 403  (NO write)
#   • Grove Infra PAT:                    no access to AgenticOS at all  (403)
# So `public-key = 200` proves READ scope only — it does NOT imply write, which is
# what the earlier GOL-342 premise assumed. No token currently has secrets:WRITE on
# AgenticOS, so `manage_github_ci_secrets` stays DEFAULT FALSE: an apply with it on
# would 403 on the PUT. Flip it to true only once the App install is granted
# Secrets:write (or a write-scoped PAT for EngineeringMoonBear/AgenticOS exists).
# (For contrast, the Grove Infra PAT DOES have proven secrets:write on grove-sites,
# which is why the script path there is self-serve today — see ../ci-secrets.yaml.)
#
# ── LEAST PRIVILEGE (blast radius)
# The advisor only READS monitoring metrics. Ideal backing token is scoped to
# `monitoring:read` (+ `droplet:read` to resolve droplet ids) — strictly
# read-only, no mutation. The existing `do_token_scoped`
# (op://Goldberry Grove - Admin/Grove Infra/do_token_scoped) is a 5-scope CRUD
# token, broader than a read-only advisor needs. Which token backs
# DO_MONITORING_TOKEN is a board decision on the GOL-252 thread; prefer the
# read-only mint.
#
# ── APPLY RECIPE (values from 1Password, never from state/CLI history)
#   Build the TF_VAR_ci_secrets JSON straight from the shared manifest so the map
#   is defined in exactly one place:
#
#     export TF_VAR_ci_secrets="$(../../tools/ci-secrets-tfvars.sh \
#         --repo EngineeringMoonBear/AgenticOS)"
#     terraform -chdir=infra/terraform apply -var manage_github_ci_secrets=true
#
#   (ci-secrets-tfvars.sh runs `op read` per manifest row and emits a
#   {SECRET_NAME: value} JSON object — the only shape `var.ci_secrets` accepts.)

provider "github" {
  token = var.github_ci_token
  owner = split("/", var.github_ci_secrets_repo)[0]
}

locals {
  github_ci_repo_name = split("/", var.github_ci_secrets_repo)[1]

  # Effective secret set = the generic map, plus the legacy single-var wiring
  # (DO_MONITORING_TOKEN) folded in for backward compatibility so existing
  # tfvars keep working. A non-empty legacy value overrides / seeds the entry;
  # an empty one contributes nothing (merge of {} is a no-op).
  legacy_ci_secrets = var.do_monitoring_token != "" ? {
    DO_MONITORING_TOKEN = var.do_monitoring_token
  } : {}

  ci_secrets = merge(var.ci_secrets, local.legacy_ci_secrets)
}

resource "github_actions_secret" "ci" {
  # Gated OFF by default (see header). `for_each` over an empty map when the gate
  # is off makes this a clean no-op — no provider auth, no plan churn. Each value
  # is encrypted at rest by GitHub and masked in logs; the github provider 6.x
  # `value` field is write-only (never read back into state).
  for_each = var.manage_github_ci_secrets ? local.ci_secrets : {}

  repository  = local.github_ci_repo_name
  secret_name = each.key
  value       = each.value
}

# GOL-253: the rightsize advisor posts its recommendation to the Grove ops
# Discord webhook. Same governance gate + non-empty guard as the DO token above.
resource "github_actions_secret" "discord_webhook_url" {
  count = var.manage_github_ci_secrets && var.discord_webhook_url != "" ? 1 : 0

  repository  = split("/", var.github_ci_secrets_repo)[1]
  secret_name = "DISCORD_WEBHOOK_URL"
  value       = var.discord_webhook_url
}
