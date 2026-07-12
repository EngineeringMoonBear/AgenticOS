# PR policy: Draft vs. Ready

This repo follows one house rule for pull requests: **open work-in-progress as
a Draft, and only mark a PR Ready when it is genuinely ready for review.**

The goal is to stop red "ready" PRs — PRs that land in the review queue with
failing checks or unmet dependencies. Draft PRs are excluded from review and
from the CI-failure escalation loop, so use them freely for WIP.

## Open as Draft when any of these is true

- The work is **WIP** — not finished, or you plan to keep pushing to it.
- It **needs human input** before it can proceed (a decision, a credential, a
  design call).
- It **depends on an unmerged PR** or a blocked issue.
- You **do not expect CI to be green** yet.

## Mark Ready only when all of these are true

- The change is **self-contained** — it stands on its own with no unmerged
  dependencies.
- You **ran the smallest local verify** that proves the change (the relevant
  test, lint, or typecheck — not necessarily the full suite).
- You **expect CI to be green**.

## How to open a Draft

- GitHub UI: use the "Create pull request" split button, then **Create draft
  pull request**.
- CLI: `gh pr create --draft`.
- Convert later: use the **Ready for review** button (or `gh pr ready
  <number>`) once the Ready criteria above are met.

When in doubt, open as Draft. It is cheap to promote a Draft to Ready; a red
"ready" PR costs reviewer attention and trips the CI-failure loop.
