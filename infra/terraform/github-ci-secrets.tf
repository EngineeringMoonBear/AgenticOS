# GitHub Actions secrets on the AgenticOS repo, managed by Terraform.
#
# GOL-252 (prereq for GOL-241 Tier 2A autoscaling): the "rightsize advisor"
# workflow needs a DigitalOcean token so it can read 7-day p95 CPU/mem for the
# AgenticOS Droplet and recommend a size. That token is exposed to CI as the
# DO_MONITORING_TOKEN Actions secret, managed here.
#
# ── GOVERNANCE GATE (same wall as state-backend/main.tf `github_actions_secret`)
# Pushing Actions secrets requires a github_token with Actions:Secrets *write*
# on the repo. The AgenticOS Infra github_token
# (op://Goldberry Grove - Admin/Grove Infra/github_token) is Contents/PR-scoped
# only — no secrets write — so an apply with `manage_github_ci_secrets = true`
# will 403 until the CEO grants secrets:write (the GOL-252 blocker).
#
# The gate defaults to false, so this file is a NO-OP on merge/apply today and
# is safe to land now: it codifies the resource and documents the seam, and the
# operator flips the gate once a secrets-scoped token exists. (AgenticOS runs no
# Terraform in CI today — apply is operator-run — matching state-backend's note.)
#
# ── LEAST PRIVILEGE (blast radius)
# The advisor only READS monitoring metrics. Ideal backing token is scoped to
# `monitoring:read` (+ `droplet:read` to resolve droplet ids) — strictly
# read-only, no mutation. The existing `do_token_scoped`
# (op://Goldberry Grove - Admin/Grove Infra/do_token_scoped) is a 5-scope CRUD
# token (droplet/app/ssh_key/vpc/monitoring), which is broader than a read-only
# advisor needs. Which token backs `var.do_monitoring_token` is a board decision
# tracked on the GOL-252 thread; prefer minting the read-only token.

provider "github" {
  token = var.github_ci_token
  owner = split("/", var.github_ci_secrets_repo)[0]
}

resource "github_actions_secret" "do_monitoring_token" {
  # Gated OFF by default (see header). Also guards on a non-empty value so an
  # apply with the gate on but no token supplied is a no-op rather than pushing
  # an empty secret.
  count = var.manage_github_ci_secrets && var.do_monitoring_token != "" ? 1 : 0

  repository  = split("/", var.github_ci_secrets_repo)[1]
  secret_name = "DO_MONITORING_TOKEN"
  # `value` (github provider 6.x) — encrypted at rest by GitHub, masked in logs.
  value = var.do_monitoring_token
}

# GOL-253: the rightsize advisor posts its recommendation to the Grove ops
# Discord webhook. Same governance gate + non-empty guard as the DO token above.
resource "github_actions_secret" "discord_webhook_url" {
  count = var.manage_github_ci_secrets && var.discord_webhook_url != "" ? 1 : 0

  repository  = split("/", var.github_ci_secrets_repo)[1]
  secret_name = "DISCORD_WEBHOOK_URL"
  value       = var.discord_webhook_url
}
