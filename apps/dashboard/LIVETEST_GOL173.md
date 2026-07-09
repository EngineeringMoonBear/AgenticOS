# Live test — GOL-173 PR review pipeline

Triggers the agent PR review pipeline via the `apps/dashboard/**` frontend path.
This validates the H1 fan-out fix (PR #287): `pull_request` now reaches `handlePrInbound`.
