# ADR 0003: Scheduler ownership — AgenticOS owns, Hermes executes

**Status**: Accepted
**Date**: 2026-05-19
**Supersedes**: nothing (affirms Phase 3 spec decision #2)
**Context**: Reopened after Hermes Agent v0.14.0 ("Foundation Release") shipped a built-in scheduler UI (`hermes dashboard --tui`) that exposes cron jobs + scheduled tasks as a first-class Hermes feature.

## Context

The Phase 3 spec (`docs/phase-3-hermes-integration.md` § 2, Decision #2) resolved cron/schedule ownership as:

> **AgenticOS owns schedules (`~/.agenticos/cron.json`); Hermes is executor.** Keeps schedule UI and persistence in the product layer; Hermes is a dumb executor.

That decision was made 2026-05-18, before Nous Research's v0.14.0 release (2026-05-18 same day, late). v0.14.0 added a Hermes-native scheduler with its own TUI for cron jobs, scheduled tasks, skills, and plugins.

This creates an apparent ownership conflict that warrants explicit re-resolution. Two viable architectures now exist:

**Option A — Affirm Phase 3 plan**: AgenticOS owns `~/.agenticos/cron.json`. The Hermes scheduler TUI is ignored. node-cron in the Next.js process fires HTTP to the Hermes `/runs` route on trigger.

**Option B — Pivot to Hermes-native**: Hermes is the source of truth for schedules. AgenticOS reads from the Hermes scheduler API. The TUI is one valid editing surface; AgenticOS's `/observability` and command palette become other surfaces over the same backing store.

## Decision

**Affirm Phase 3 decision #2 — Option A. AgenticOS owns scheduling. Hermes is executor.**

The Hermes v0.14.0 TUI is treated as a sidecar editing surface that AgenticOS does not integrate with. Users edit schedules through the AgenticOS UI; the Hermes TUI is available but not the canonical surface.

## Rationale

Four reasons that compound:

### 1. Cross-lane scheduling

Phase 4 adds Sandcastle (ephemeral parallel coding agents in git worktrees) as a second execution lane. Sandcastle is not Hermes. If schedules live in Hermes, Sandcastle runs need a separate scheduler — defeating the single-source-of-truth goal. AgenticOS-owned scheduling already covers both lanes uniformly.

### 2. Cron config is product data, not runtime data

`~/.agenticos/cron.json` is the user's persistent configuration of *what they want to happen and when*. Hermes is a runtime — its schedule store is engine state, lifecycle-coupled to the daemon. Mixing the two means rebuilding schedules every time Hermes restarts (or relying on Hermes to persist them, which couples the user's product config to a specific engine version).

### 3. Schedule semantics live in AgenticOS's domain model

AgenticOS schedules carry project tags, lane assignments, skill metadata, and budget caps — concepts that originate in AgenticOS, not Hermes. Hermes's TUI would need to learn these to be a useful editing surface for AgenticOS users. The other direction (AgenticOS reading from a Hermes-native scheduler) means flattening AgenticOS's richer schedule shape into Hermes's simpler one.

### 4. The TUI is fine for Hermes-direct users; not better for AgenticOS users

The `hermes dashboard --tui` is a great affordance for users running Hermes standalone. For users running it under AgenticOS, the AgenticOS schedule UI is the natural editing surface — exposing the Hermes TUI as a second surface would create the "two ways to do the same thing" anti-pattern.

## Consequences

### Affirmed

- node-cron loop in the Next.js process is the trigger source. (§ 4 of Phase 3 spec.)
- `~/.agenticos/cron.json` with atomic writes (tmp+rename+chmod 0600) is the canonical store.
- Scheduler sanity-cancels stale `running` runs (>30 min silent) before next fire.
- "Run now" manual trigger button per schedule.

### New consequences from v0.14.0

- **Document for users**: the Hermes TUI scheduler exists but is not where AgenticOS users should schedule things. Avoid silent dual-write confusion. Add a banner or `agenticos doctor` warning if `hermes dashboard --tui` cron entries are detected at a known location (gating: only if discoverable without polling).
- **Hermes daemon health remains the trust boundary**: when Hermes is down, AgenticOS schedules queue locally and fire on daemon recovery (existing behavior unchanged).
- **If we ever pivot to Option B**, the migration is non-trivial: re-encoding `~/.agenticos/cron.json` semantics into Hermes's scheduler model and reverse-engineering Hermes's API for schedule CRUD. The fact that v0.14.0's TUI is described as a UI without a documented API surface is a signal that the Hermes scheduler is currently a leaf feature, not yet a stable integration target.

### Migration path if we revisit

If Phase 5 or 6 reveals that Option A is wrong — for example, if Hermes adds a stable scheduler REST API and we want AgenticOS to consume it for free retry/backoff logic — the migration path is:

1. Add a `hermes.scheduler.useNative: false` flag in `~/.agenticos/config.json`.
2. Implement a Hermes-scheduler adapter behind the existing `Scheduler` interface in `apps/dashboard/lib/scheduler/`.
3. Migrate existing `~/.agenticos/cron.json` entries to Hermes via the new API.
4. Flip the default. Keep the local scheduler as fallback.

This is tractable but not urgent. Phase 3 ships with Option A as designed.

## References

- Phase 3 spec § 2 Decision #2: `docs/phase-3-hermes-integration.md`
- Phase 3 brainstorming checkpoint: `docs/phase-3-brainstorming-checkpoint.md`
- Hermes v0.14.0 walkthrough transcript: `vault/sources/2026-05-19-hermes-foundation-update-v0.14.0.md`
- Vault wiki entry tracking implications: `vault/wiki/Software/AgenticOS.md` § "Hermes v0.14.0 ('Foundation Release') — implications for Phase 3"
