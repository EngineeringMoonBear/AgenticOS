# main-branch protection as a ruleset (Layer 2 of the merge-automation spec).
#
# Replaces classic branch protection, which cannot express a merge queue.
# `strict` (require-branches-up-to-date) is deliberately GONE: it forced a manual
# "Update branch" on every open PR after each merge, and the queue supersedes it
# by building and testing the prospective merge commit itself.
#
# OPERATOR AMENDMENT (2026-08-03): the `pull_request` rule below was added
# after the plan was written, to restore CODEOWNERS enforcement (security
# review finding M2). `.github/CODEOWNERS` only binds when a ruleset with
# "Require review from Code Owners" is enabled — classic protection on `main`
# has `required_pull_request_reviews: null`, so CODEOWNERS is inert today, and
# a separate change (Layer 4) is making the auto-approve workflow's
# sensitive-path gate default off. This ruleset is where that protection gets
# restored structurally.
#
# `required_approving_review_count = 0` + `require_code_owner_review = true`
# is GitHub's documented ruleset pattern for "no generic approvals required,
# but a designated code owner must approve changes to paths they own": the two
# fields are independent (see the `integrations/github` provider docs for
# `rules.pull_request`), and `require_code_owner_review` only engages for
# files that have a CODEOWNERS entry. So an ordinary PR touching no
# CODEOWNERS path needs zero approvals — hands-free auto-merge still works —
# while a PR touching a CODEOWNERS path (`.github/`, `infra/`,
# `docker-compose*`, `scripts/agent-git/`, `packages/credential-broker/`,
# `.gitleaks.toml`, `Dockerfile*`) requires the code owner's approval.
# `github-actions[bot]` (the auto-approve workflow's identity, see
# .github/workflows/auto-approve.yml) is not a code owner — only
# @EngineeringMoonBear is — so its approval cannot satisfy this requirement.
# See docs/superpowers/specs/2026-08-03-agent-pr-merge-automation-design.md
# for the full design and the amendment note appended there.
resource "github_repository_ruleset" "main" {
  name        = "main"
  repository  = "AgenticOS"
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]
      exclude = []
    }
  }

  rules {
    deletion                = true
    non_fast_forward        = true
    required_linear_history = true

    required_status_checks {
      strict_required_status_checks_policy = false

      required_check { context = "Lint" }
      required_check { context = "Typecheck" }
      required_check { context = "Unit tests" }
      required_check { context = "Build" }
    }

    merge_queue {
      check_response_timeout_minutes    = 60
      grouping_strategy                 = "ALLGREEN"
      max_entries_to_build              = 5
      max_entries_to_merge              = 5
      merge_method                      = "SQUASH"
      min_entries_to_merge              = 1
      min_entries_to_merge_wait_minutes = 5
    }

    # Operator amendment — restores CODEOWNERS enforcement (finding M2).
    # See the header comment above for why 0 + true achieves "zero approvals
    # for ordinary PRs, code-owner approval required on sensitive paths."
    pull_request {
      required_approving_review_count = 0
      require_code_owner_review       = true
    }
  }
}
