# Discipline routing + agent PR review gate — design spec

- **Date:** 2026-07-08
- **Status:** Approved (Josh, brainstorm session 2026-07-08)
- **Owner for implementation:** Engineering (Alice)
- **Systems touched:** `packages/github-sync-plugin`, GitHub App "AgenticOS Developer", `infra/terraform/cloudflare-qa-webhook.tf`, repo rulesets (later phase)

## Goal

1. GitHub issues route to the right agent by discipline: **frontend → Iris**, **features/code → Alice**, **bugs / infra / observability alerts → Terra**; unlabeled → **Rick** for triage.
2. Every non-draft PR gets agent code review: **Alice always**, **Iris additionally when frontend paths change**. Agent sign-off becomes the merge gate (replacing the human-review requirement Josh currently bypasses). QA-deploy review is subsumed: reviews happen pre-merge, so nothing reaches a QA deploy unreviewed.
3. Discord ops channel gets **low-noise, state-change-only** alerts for all of the above.

## Decisions already made (do not re-litigate)

- Routing signal = **GitHub labels**, deterministic. No LLM classifier (may be added later for unlabeled issues).
- Label precedence: **`infra` = `bug` = `alert` > `frontend` > `feature`**. First match by precedence wins.
- Unlabeled / unmatched fallback assignee = **Rick (CEO)** for triage.
- Sign-off mechanism = **check-runs on the PR head SHA** (NOT App-submitted approving reviews — one-App-one-identity can't distinguish Alice/Iris, and bot-approval counting toward `required_approving_review_count` is GitHub-version-dependent; required status checks are first-class in rulesets).
- Phased rollout; the ruleset flip is LAST and only after a week of proven sign-offs.

## Agent ids (current company `6a74334e-9dd3-4491-8cd5-da418e970a2e`)

| Agent | id |
|---|---|
| Engineering – Alice | `1809e0f4-cdd8-4ac9-912d-b6678d71d29a` |
| Frontend – Iris | `0f58aac8-dbf7-4af7-bab7-944b067d01af` |
| DevOps – Terra | `ecb7b6ec-3c2a-4509-9bac-4ad33c07d03f` |
| CEO – Rick | `f1a80667-80fc-4109-8d30-27b234632db4` |

## System 1 — label routing (plugin v0.6.0)

Bridge config schema gains:

```jsonc
{
  "labelRouting": {          // label name -> assigneeAgentId
    "frontend": "<Iris>",
    "feature":  "<Alice>",
    "bug":      "<Terra>",
    "infra":    "<Terra>",
    "alert":    "<Terra>"
  },
  "fallbackAssigneeAgentId": "<Rick>"
}
```

`createMirrorIssue` assignee resolution order:
1. Match issue labels against `labelRouting` using the fixed precedence above.
2. No match → `fallbackAssigneeAgentId`.
3. Neither configured → existing `defaultAssigneeAgentId` (backward compatible; existing config keeps working unchanged).

Machine sources self-label: QA-smoke failure issues add `bug`; observability-alert issues add `alert` (touch those creators as a follow-up task, not a blocker).

## System 2 — PR review pipeline + merge gate

- **Events:** subscribe the GitHub App to **`pull_request`** (App settings — human step, Josh). New manifest webhook endpoint `github-pr` on the same plugin; same `appWebhookSecret` HMAC; skip `draft` PRs; act on `opened`, `reopened`, `ready_for_review`, `synchronize`.
- **On opened/reopened/ready:** worker fetches the PR changed-file list via the gh-token-broker token. Creates review issue(s) in the bridge's project:
  - Always: `Review PR #N — <title>` → **Alice**.
  - If any changed path matches `frontendPaths` config globs (start: `apps/dashboard/**`, `**/*.tsx`, `**/*.css`): a second review issue → **Iris**.
  - Issue body: PR link, head SHA, changed-file summary, review checklist, loop-prevention marker (`<!-- pr-review: <repo>#<n>@<sha> -->`). Idempotent per (repo, PR, head SHA).
- **Sign-off:** reviewing agent posts a **check-run** on the head SHA via broker token (App needs `checks:write` — verify/add permission): context `agent-review/alice` or `agent-review/iris`, conclusion `success`, or `failure` + a PR comment with requested changes.
- **On `synchronize` (new commits):** reset relevant check-runs to in-progress/pending and reopen (`todo`) the review issues with a "new commits" note.
- **Gate (Phase 3 only):** ruleset requires check `agent-review/alice` (Alice's sign-off protocol includes confirming Iris's check is green when a frontend review issue exists — keeps exactly one globally-required check). Human-review requirement + Josh's bypass retired. Terraform-codify with the GOL-69 ruleset-as-code work.

## System 3 — Discord alerts (smart, not noisy)

Same best-effort `opsWebhookUrl` mechanism as today (failures logged, never blocking). One-liners, severity-prefixed, **state changes only**:

| Ping | Format |
|---|---|
| ✅ Issue routed | `🧭 AgenticOS#256 → Iris (frontend)` |
| ✅ Fallback to Rick | `⚠️ AgenticOS#257 unlabeled → Rick (triage)` |
| ✅ Review issues created | one per PR: `🔍 PR AgenticOS#260 → Alice + Iris` |
| ✅ Sign-off green | `✅ PR #260 agent-review/alice` |
| ✅ Changes requested | `❌ PR #260 — Alice requested changes` |
| ✅ Pipeline errors (HMAC reject, check-post fail, API error) | `🔥 …` |
| ❌ Silent | redeliveries, duplicates, bot-origin skips, draft PRs |

## Rollout phases

1. **Phase 1 — routing.** v0.6.0 labelRouting + routing pings. Prove: labeled test issues land on Iris/Alice/Terra; unlabeled lands on Rick.
2. **Phase 2 — review pipeline, gate untouched.** PR events → review issues → agents post check-runs (non-required). Josh keeps approving as today. Soak ~1 week; watch sign-off reliability in Discord.
3. **Phase 3 — flip the gate.** `agent-review/alice` becomes a required check; human-review requirement dropped. Admin bypass remains the emergency exception only.

**Failure posture:** plugin down in Phase 3 = no review issues = required check never green = merges block. This is fail-closed and intentional; the 🔥 alert is the operator signal. Escape hatch = admin bypass.

## Implementation gotchas (hard-won, do not rediscover)

- **Secret-ref trap:** any config field marked `format:"secret-ref"` is silently STRIPPED on save (host resolution disabled). Keep exactly ONE sacrificial marked field (`githubToken`); all real secrets as plain hex fields. Verified 2026-07-08 (PR #255).
- **Bump manifest `version:` on ANY manifest change** — #228 didn't, and the stale stored manifest masked a broken endpoint for days.
- **Manifest changes need delete + reinstall** (`scripts/deploy-plugin.sh github-sync-plugin`) + full config re-POST (config is wiped; secrets live in 1Password `AgenticOS Infra`: `github_sync_app_webhook_secret`, `github_sync_inbound_webhook_secret`) + disable/enable.
- **Each new public webhook endpoint needs its own CF Access Bypass app** (most-specific path wins): add `…/webhooks/github-pr` to `infra/terraform/cloudflare-qa-webhook.tf` mirroring the `github-app` one. GitHub cannot send CF service-token headers.
- **App events subscription is a human step** (App settings → Subscribe to events → Pull requests) — verify with `gh api orgs/<org>/installations` (`events` list).
- **Issues API:** agent assignee field is `assigneeAgentId` (not `assigneeId`).
- Worker currently mirrors only `action:"opened"` for issues — PR endpoint must handle its own action set (`opened|reopened|ready_for_review|synchronize`).

## Testing

- Unit: label precedence (multi-label conflicts), fallback, frontendPaths glob matching, PR action filtering, idempotency per head SHA.
- Live, per phase: Phase 1 — four test issues (frontend/feature/bug/unlabeled) land on Iris/Alice/Terra/Rick. Phase 2 — PR touching `apps/dashboard/**` produces two review issues + (after agent review) two check-runs on the head SHA. Phase 3 — unreviewed PR is blocked; reviewed PR merges with no human approval.
