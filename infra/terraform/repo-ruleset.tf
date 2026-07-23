# AgenticOS `main` merge-gate, codified as a repository ruleset (GOL-578).
#
# Phase 3 execution for GOL-460 / GOL-150 spec
# `docs/superpowers/specs/2026-07-08-discipline-routing-agent-pr-review-design.md`.
# This is the infra half of the agent-PR-review rollout: the plugin/app half
# (label routing + PR review issues + `agent-review/ada` check-runs) is shipped.
# Here we make that agent sign-off the *required* merge gate on `main`.
#
# ─────────────────────────────────────────────────────────────────────────────
# STATUS: STAGED, NOT APPLIED. Gated OFF by default (see the feature flag below,
# and `count` on the resource). An accidental `terraform apply` with the current
# defaults is a NO-OP — it manages zero ruleset resources. Two gates must clear,
# IN ORDER, before this is flipped on and applied:
#
#   1. SOAK GATE — spec requires ~1 week of reliable, real Ada sign-offs on live
#      PRs first. `prReviewAliceAgentId` was re-pointed to Engineering-Ada on
#      2026-07-19 16:06 UTC (GOL-535), so soak starts then; earliest apply is
#      ≈ 2026-07-26, and only after `agent-review/ada` is observed going green
#      on real PRs (watch the Discord ✅ pings).
#   2. BOARD CONFIRMATION — GOL-460 carries a pending request_confirmation to
#      CEO-Rick (confirm Ada as the reviewer identity + Option A + authorize the
#      prod apply). Do NOT `terraform apply` before that is accepted.
#
# APPLY IS A HUMAN STEP. Managing rulesets needs a github provider token with
# repo-administration scope. `var.github_ci_token` (op://…/Grove Infra/github_token)
# is Contents/PR-scoped only — the same GOL-252 governance wall that gates
# `manage_github_ci_secrets`. So the apply runs via Josh, escalated through
# CEO-Rick, with an admin-scoped token — never hand-edited in the repo settings UI.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHAT THIS CODIFIES vs. LIVE STATE (verified against the GitHub API 2026-07-19):
#
#   * The live gate on `main` today is CLASSIC branch protection (NOT a ruleset):
#       required_status_checks.strict = true
#       contexts = ["Lint", "Typecheck", "Unit tests", "Build"]  (all app 15368 = Actions)
#       required_pull_request_reviews = ABSENT   ← there is NO human-review requirement
#       enforce_admins = false                   ← admins already bypass (the escape hatch)
#     The ruleset `main-branch-protection` (15851627) referenced in the GOL-392
#     thread (2026-07-15) has since been DELETED; only a disabled `ClaudeLimits`
#     ruleset remains. So state has drifted from that note — this file codifies
#     the *current* reality plus the GOL-578 delta.
#
#   * FINDING for GOL-578's "retire the human-review requirement": there is
#     nothing to retire — the live classic protection requires ZERO approving
#     reviews already. The github-actions[bot] auto-approval (auto-approve.yml)
#     is therefore a no-op for the gate today; the real gate is just the CI
#     status checks. This file keeps human review OUT of the gate (no
#     `required_approving_review_count > 0`) and adds the agent check, which is
#     exactly the Phase 3 target posture.
#
#   * THE DELTA this resource introduces = one new required status check,
#     `agent-review/ada`. Per the spec, Alice's (now Ada's) sign-off protocol
#     includes confirming Iris's `agent-review/iris` check is green when a
#     frontend review issue exists, so exactly ONE check is globally required.
#     `agent-review/ada` stays an opaque required-check id (no rename), per the
#     GOL-535 note — Engineering-Ada posts it; the context string is unchanged.
#
# MIGRATION NOTE (coordinate with GOL-392, the base-ruleset-as-code work): this
# ruleset and the live classic branch protection would BOTH evaluate on `main`
# if applied side-by-side (GitHub takes the union / most-restrictive). The apply
# runbook must therefore, in the same change window, remove the classic
# protection (or fold it in) so there is a single source of truth. GOL-392 owns
# the base ruleset decision (which CI checks are required — e.g. whether
# `Dependency audit` / `Secret scan` join the set); this file deliberately
# mirrors ONLY the four checks that are required on live `main` today and adds
# the agent check, so it introduces no new opinion on that open question.

# -----------------------------------------------------------------------------
# EMISSION CONFIRMED (DevOps-Terra, GitHub API, 2026-07-23) -- SOAK CLOCK STARTED:
# The 2026-07-22 blocking finding (no `agent-review/*` check on any live PR) is
# RESOLVED. Root cause was two-fold and both parts have shipped:
#   * Firing regression fixed (GOL-717 / PRs #402-#404 merged) -- the plugin now
#     seeds the agent-review check-run on opened PRs.
#   * Reviewer slug renamed alice -> ada (GOL-713 / PR #401 merged 2026-07-23,
#     plugin reloaded via POST /api/plugins/<id>/upgrade) -- so the byte string
#     it now posts is `agent-review/ada`, matching var.agent_review_check_context.
# LIVE PROOF: PR #408 (head 0dad39ec) carries `agent-review/ada` -> completed /
#   conclusion=success. That is the first real green emission; the ~1-week soak
#   window begins here (earliest board-approved apply still ~2026-07-26).
# Note: older pre-rename PRs still show a stale `agent-review/alice` check (e.g.
#   PR #403 head eb466534, stuck in_progress) -- historical, not a blocker; those
#   PRs predate the reload and are irrelevant to the forward gate.
# REMAINING GATES before flipping enable_agent_review_merge_gate = true and
# applying (all still open, unchanged):
#   1. SOAK -- accumulate ~1 week of reliable green `agent-review/ada` emissions
#      on live PRs; DevOps re-verifies breadth (not just one smoke PR) at apply.
#   2. BOARD -- CEO-Rick accepts the GOL-460 request_confirmation (Ada identity +
#      Option A + authorize prod apply).
#   3. HUMAN APPLY -- via Josh with a repo-administration-scoped github token
#      (GOL-252 wall), escalated through CEO-Rick.
#
variable "enable_agent_review_merge_gate" {
  description = <<-EOT
    Phase-3 feature flag (GOL-578 / GOL-460). When true, Terraform manages the
    `main` merge-gate ruleset that makes `agent-review/ada` a required status
    check and keeps human review out of the gate. Default false = no ruleset is
    managed at all (count = 0), so the resource is inert until BOTH the soak gate
    (~2026-07-26) and CEO-Rick's confirmation on GOL-460 have cleared. Flipping
    this true also requires a repo-administration-scoped github provider token
    (var.github_ci_token is PR-scoped only — GOL-252 wall).
  EOT
  type        = bool
  default     = false
}

variable "agent_review_check_context" {
  description = <<-EOT
    The exact status-check context string that the github-sync plugin posts as
    the agent PR-review sign-off, which this ruleset makes a required merge gate.
    Corrected alice -> ada per the board comment on GOL-578 (2026-07-22).

    APPLY-SAFETY INVARIANT: this MUST match the context the plugin actually
    emits on the PR head SHA, byte-for-byte. GitHub matches required checks by
    context name; if the plugin never posts a check with this name, the gate is
    permanently fail-closed and NO PR can merge to `main` (admins excepted).
    Confirmed green on live PR #408 (head 0dad39ec, `agent-review/ada` =
    success) on 2026-07-23 -- see the EMISSION CONFIRMED block above; re-verify
    breadth of emission before the board-approved apply.
  EOT
  type        = string
  default     = "agent-review/ada"
}

resource "github_repository_ruleset" "main_merge_gate" {
  count = var.enable_agent_review_merge_gate ? 1 : 0

  name        = "main-merge-gate"
  repository  = local.github_ci_repo_name # "AgenticOS"; owner comes from the github provider
  target      = "branch"
  enforcement = "active" # fail-closed by design: plugin down => check never green => merges block

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"] # the repo's default branch (main)
      exclude = []
    }
  }

  # Emergency-only escape hatch: repository admins (role id 5) may bypass. This
  # is the deliberate replacement for classic protection's `enforce_admins=false`
  # — admins keep an override for incident/rollback, but it is NOT a routine
  # gate for anyone else. `always` = the bypass applies to pushes and PR merges.
  bypass_actors {
    actor_id    = 5 # built-in "Admin" repository role
    actor_type  = "RepositoryRole"
    bypass_mode = "always"
  }

  rules {
    # Mirror the current live protection posture on `main`.
    deletion                = true
    non_fast_forward        = true
    required_linear_history = true

    required_status_checks {
      # `strict` = branch must be up to date with base before merge (matches the
      # live classic protection's strict:true and the spec's proxy-for-main note).
      strict_required_status_checks_policy = true

      # The four CI checks required on live `main` today (app 15368 = GitHub
      # Actions). integration_id is intentionally left unpinned here — GitHub
      # matches by context name — but pinning these to 15368 (and
      # agent-review/ada to the AgenticOS Developer App id) is a hardening
      # follow-up worth doing when GOL-392 converges the base ruleset.
      required_check {
        context = "Lint"
      }
      required_check {
        context = "Typecheck"
      }
      required_check {
        context = "Unit tests"
      }
      required_check {
        context = "Build"
      }

      # ── GOL-578 delta: the agent review sign-off becomes a required check. ──
      # Engineering-Ada posts this check-run on the PR head SHA via the
      # gh-token-broker token (context unchanged per GOL-535). This is the one
      # globally-required *review* signal; Iris's `agent-review/iris` is folded
      # in via Ada's sign-off protocol, not required separately.
      required_check {
        context = var.agent_review_check_context
      }
    }

    # Require merges to go through a pull request, but DO NOT require any human
    # approving reviews — this is the "retire the human-review requirement" half
    # of Phase 3. (Live classic protection has no review requirement at all, so
    # this preserves the zero-human-approval posture while keeping the PR flow
    # under which the CI + agent checks are evaluated.)
    pull_request {
      required_approving_review_count   = 0
      dismiss_stale_reviews_on_push     = true
      require_code_owner_review         = false
      require_last_push_approval        = false
      required_review_thread_resolution = false
    }
  }
}
