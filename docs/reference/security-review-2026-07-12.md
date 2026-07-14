# Security review + dashboard truth audit — 2026-07-12

Full-repo review at `main` @ `7246ecc` (722 files): a security sweep and a
dashboard "truth audit" (every UI feature traced component → hook → route →
backend). Each finding below was verified against the source before being
reported. Fix PRs were opened the same day.

## Security findings

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| H1 | **High** | The App Platform default URL (`*.ondigitalocean.app`) serves the dashboard directly, bypassing Cloudflare Access; `proxy.ts` allowlisted that host family and no `/api/*` route had inbound auth (incl. `POST /api/config`, vault inbox discard/commit). Host checks can't close it — direct clients control their own Host header. | [#357](https://github.com/EngineeringMoonBear/AgenticOS/pull/357) — verify `Cf-Access-Jwt-Assertion` (WebCrypto RS256, JWKS-cached) in proxy.ts, fail-closed; Terraform wires `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` from the Access app resource. **Apply TF before merge.** |
| M1 | Medium | otel-collector exports carry OpenObserve **root** basicauth; the deploy default pointed at cleartext `http://159.65.46.198:5080` (no repo var overrides it → live). | [#358](https://github.com/EngineeringMoonBear/AgenticOS/pull/358) — TLS hostname default. Follow-up: scoped ingest-only OO user. |
| M2 | Medium | Hands-free auto-merge (GOL-308) gated on the CI workflow only — CodeQL/gitleaks/actionlint never gated the merge, and agent PRs could rewrite workflows/infra/compose/brokers and self-ship to prod. | [#359](https://github.com/EngineeringMoonBear/AgenticOS/pull/359) — sensitive-path carve-out (mirrored in `.github/CODEOWNERS`) + all-checks-green poll on the head SHA. |
| M3 | Medium | `gh-token-broker` minted GitHub App installation tokens for **any** compose-network caller, for **any** repo the App is installed on — no caller auth. | [#356](https://github.com/EngineeringMoonBear/AgenticOS/pull/356) — required timing-safe bearer + `GH_BROKER_ALLOWED_OWNERS`. **Provision droplet key files before merge** (commands in the PR). |

Low / accepted trade-offs: otel-collector as root with ro docker.sock + ro
hostfs (mitigated: read-only mounts, digest-pinned image — keep the pin);
public SSH :22 (candidate: restrict to Tailscale); first-party GitHub actions
pinned by tag while third-party are SHA-pinned.

Patterns verified GOOD (preserve): zero hardcoded secrets anywhere;
single-holder secret architecture (App key and DO PAT each live in exactly one
broker process); every compose port bound to the VPC IP or 127.0.0.1 (dodges
Docker's UFW bypass); timing-safe compares + linear header parsing throughout;
fork-PR-safe workflows (no `pull_request_target`, untrusted event fields only
via `env:`).

## Dashboard truth audit

Verdict: **18 features REAL · 12 FAKE · 4 PARTIAL.** The Paperclip-path panels
honor the data-fidelity rule ("never a fabricated value"); the hero vistas and
health tab do not.

Fake **in production** (routes with no `DASHBOARD_DATA_SOURCE` guard):

- `/api/health/services` — canned per-service latencies, always ok
- `/api/health/resources` — hardcoded CPU/RAM/disk numbers
- `/api/health/external` — external providers forever "ok"
- `/api/health/backups` — **permanently reports backups healthy** (the most
  dangerous fake on the board)

Fake elsewhere: Cost/Health/Memory/Architecture hero vistas (hardcoded tiles),
oscilloscope + memory-accumulation backdrops (fake curves labeled with real
service names), VaultIngestPanel (canned runs), command-palette Skills group
(`lib/fixtures/skills.ts`, invented success rates), run-detail page ("Phase 3"
dead-end), Schedules page (fetches `/api/cron/*` — routes that don't exist),
`metrics-sidebar.tsx` (dead code).

Disposition (tracked as the `[Truth pass]` tasks on the AgenticOS Asana
board): **wire** the eight fakes whose real sources already exist
(`/api/cost/*`, `/api/viking/scopes`, `/api/vault/stats`, `/api/agent/health`,
the orphaned `/api/ingest/status`, `/api/vault/skills`, the unused SSE
run-events route, and the GOL-313 OpenObserve `system_*` metrics for
SystemResources); **deprecate** the Schedules page, metrics-sidebar, the
per-skill dispatch tile, and BackupsPanel (unless backup jobs start writing a
queryable log). `RunsVista` is the reference implementation for honest
loading/empty states.
