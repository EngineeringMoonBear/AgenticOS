# Phase 5 — Connector Plugin System: Design Brief

> **⚠️ STALE (predates 2026-05-20 foundation v2 pivot):** Written when connectors were planned on top of a Hermes-daemon + Sandcastle architecture. The foundation v2 spec ([`docs/superpowers/specs/2026-05-20-agenticos-foundation-v2-design.md`](superpowers/specs/2026-05-20-agenticos-foundation-v2-design.md)) reshapes the integration substrate: connectors will plug into the MCP-to-vault + Honcho composition, likely with a LAN-resident Raspberry Pi for domain devices (smart home, networking, farm IoT). The plugin-system concepts here largely carry forward; the Hermes/Sandcastle plumbing references need rewriting. **Don't treat this brief as current scope.**

**Status**: Brainstorming (2026-05-18) — stale; re-scope against foundation v2 when v2 brainstorming begins
**Owner**: AgenticOS — single-developer (Josh)
**Predecessors required**: Foundation v2 v1 (Curator + dashboard observability) merged; v2 multi-agent layer scoped.
**Asana tasks**: T1 GID 1214851299454281, T2 GID 1214851299669089, T3 GID 1214851299690773, T4 GID 1214851403865054, T5 GID 1214851299735884, T6 GID 1214851415979429

---

## Format note

Each question below states a proposed answer with supporting rationale. These are recommendations, not locked decisions — open items call that out explicitly.

---

## Q1 — Plugin interface shape: class-based, factory function, or declarative module spec?

**Proposed**: Factory function returning a typed `ConnectorPlugin` object.

Class-based plugins introduce inheritance chains, `this`-binding bugs, and make tree-shaking harder. Declarative module specs (plain objects) are simple but lack a clean way to run constructor-time secret validation. The factory function lands between: it is called once at initialization, receives secrets via its single argument, validates them eagerly, and returns a frozen descriptor object.

```ts
// packages/connector-core/src/types.ts

export interface ConnectorPlugin {
  readonly id: string;                    // e.g. "slack", "farmos"
  readonly displayName: string;
  readonly tools: ConnectorTool[];        // see Q3
  readonly healthCheck: () => Promise<ConnectorHealth>;
  readonly teardown?: () => Promise<void>;
}

export interface ConnectorTool {
  readonly name: string;                  // MCP tool name: "<id>.<method>"
  readonly description: string;
  readonly inputSchema: z.ZodTypeAny;
  readonly handler: (input: unknown) => Promise<unknown>;
}

export type ConnectorFactory = (secrets: ConnectorSecrets) => ConnectorPlugin;
```

Each connector file (`packages/connectors/farmos/index.ts`) exports a single `ConnectorFactory`. The `ConnectorRegistry` in `packages/connector-core/` calls each factory at boot (see Q4) and registers the returned tools.

This mirrors Phase 2's approach of a typed `VaultStore` interface as the single public contract — connectors hide their internals behind the interface; callers only see `ConnectorPlugin`.

---

## Q2 — Auth storage: `~/.agenticos/secrets.json` vs macOS Keychain (node-keytar)?

**Proposed**: `~/.agenticos/secrets.json` with atomic write + `chmod 0600`, matching Phase 3's `cron.json` pattern.

Phase 3's scheduler writes `~/.agenticos/cron.json` via `tmp + rename + chmod 0600` atomic writes — the same pattern Phase 2 established for vault inbox commits. Extending that to `secrets.json` is consistent, zero new dependencies, and fully auditable (the file is on-disk and inspectable with standard tools).

node-keytar is a compelling alternative — macOS Keychain gives hardware-backed encryption and protects secrets even if `~` is synced to iCloud. The counterargument: node-keytar is a native addon (requires `node-pre-gyp` or platform build), breaks in Docker/Daytona Sandcastle containers, and adds per-connector Keychain permission dialogs that interrupt first-run. For a localhost-only, single-user system where `~/.agenticos/` is already assumed to be a secrets boundary, `secrets.json` is the pragmatic choice.

**Atomic write contract** (borrowing Phase 2's language verbatim):
1. Write to `~/.agenticos/secrets.tmp.json`
2. `chmod 0600` on the temp file
3. `rename()` (atomic on POSIX) to `secrets.json`
4. Validate the result with Zod before returning to caller

The `ConnectorConfigSchema` in `apps/dashboard/lib/config/schema.ts` currently holds `{ id, enabled }`. Phase 5 extends it to `{ id, enabled, baseUrl? }` (for self-hosted connectors like farmOS/Odoo/Ghost). Secrets — API keys, OAuth tokens — never live in `AgenticOSConfig`; they live in `secrets.json` only.

---

## Q3 — Tool exposure model: auto-register all methods or whitelist per skill?

**Proposed**: Auto-register all `ConnectorTool` entries declared in the plugin's `tools` array, with the plugin author responsible for the whitelist.

Each `ConnectorPlugin` already declares its `tools` array (see Q1). The `ConnectorRegistry` iterates that array and registers every entry as an MCP tool on the connector MCP server (see Section 2 below). This is equivalent to how Phase 3's MCP-to-vault binding exposes all 11 vault tools to Hermes — the tool surface is defined once in the plugin, not split across a separate allowlist file.

Per-skill whitelisting (giving each skill a `connectors.allowedTools` list in its YAML frontmatter) is a Phase 6 hardening concern. At Phase 5 volume (five to six connectors, single developer, no multi-tenant), the friction outweighs the security benefit. Document the gap as a known risk (see Risks section).

---

## Q4 — Connector lifecycle: eager init at boot or lazy on first use?

**Proposed**: Eager init for enabled connectors, with a non-blocking boot strategy.

The AgenticOS dashboard server process initializes the `ConnectorRegistry` at startup. For each connector where `config.connectors.find(c => c.id === id).enabled === true`, it calls the `ConnectorFactory` immediately, which validates secrets and opens any persistent connections (e.g., OAuth token refresh). If a connector's factory throws (missing secret, invalid base URL), that connector is marked `status: "error"` in the registry — the dashboard still starts, other connectors are unaffected.

Lazy init sounds appealing but creates two problems: the first tool call in a skill run pays the init latency (potentially a token refresh round-trip), and health checks become meaningless until first use. Eager init surfaces misconfigurations at startup, not mid-run, which is strictly better UX.

The Settings connector table shows `status: "error" · Missing API key` immediately at page load — no "first tool call" discovery required.

---

## Q5 — Health checks: built-in `/api/connectors/health`?

**Proposed**: Yes. One route, per-connector status, called by the dashboard on Settings page open and on a 60s poll while Settings is active.

```
GET /api/connectors/health
→ { connectors: [{ id, status: "ok"|"error"|"disabled", latencyMs, detail }] }
```

Each enabled connector's `healthCheck()` function (declared in the plugin interface, see Q1) is called in parallel with `Promise.allSettled()`. The route returns within a 5-second timeout — any connector that doesn't respond by then is marked `status: "timeout"`.

This is a natural extension of Phase 3's Hermes health chip (`/api/hermes/health` polled every 5s). The same `ConnectorHealthChip` pattern used for Hermes can be componentized and reused per-connector in the Settings table.

---

## Q6 — Rate-limit handling: extend Phase 3 `lib/limits/` to track per-connector quotas?

**Proposed**: Yes, extend `lib/limits/` with a `ConnectorLimitStore` that mirrors the Anthropic rate-limit tracker.

Phase 3 built `~/.agenticos/rate-limits.jsonl` to capture Anthropic's six limit dimensions from response headers. The connector equivalent: each connector plugin may optionally implement `readonly quotaHeaders?: string[]` — a list of response header names it expects to carry quota information. The `ConnectorLimitStore` reads those headers on every tool call response and appends to `~/.agenticos/connector-limits.jsonl`.

Connectors that don't carry quota headers (e.g., farmOS — self-hosted, no quota) simply omit the field. Connectors with known quotas (Asana: 1,500 req/min; Ghost: no documented hard limit; Slack: tier-variable) declare them.

The Observability metrics sidebar gains a "Connectors" sub-panel alongside the existing Anthropic rate-limit panel — same three nested views (compact, expanded, projection). The projection view is especially useful: "Slack (next Curator run: 03:00) — 430 messages capacity remaining" or "⚠ Asana quota at 78%, risk of throttle."

---

## Q7 — Ordering for parallel execution: dependency declaration or FIFO?

**Proposed**: FIFO within each skill run. No dependency graph at Phase 5.

Phase 5 connectors are invoked by Hermes skills, not by each other. A skill's prompt determines which tools get called and in what order — Hermes handles that sequencing. Declaring inter-connector dependencies at the registry layer would be premature: no Phase 5 skill chains farmOS output directly into an Odoo write in a way that requires the registry to enforce ordering. If that pattern emerges in Phase 6, add `dependsOn: string[]` to the plugin interface then.

FIFO registry initialization (connectors initialized in `DEFAULT_CONNECTORS` array order) is deterministic and debuggable.

---

## Q8 — Error surfacing: run-card status or separate `connector-errors` log?

**Proposed**: Primary surface is the run card (status `failed`, detail in logs tab). Secondary: append to `~/.agenticos/connector-errors.jsonl` for cross-run diagnostics.

A connector tool call that throws is already a tool call failure in the Hermes run event stream — the run card's Logs tab will show it. That's the right primary surface: the error lives in context with the run that triggered it.

The `connector-errors.jsonl` log answers a different question: "has farmOS been failing intermittently across multiple runs this week?" That cross-run view is surfaced in the Observability Connectors sub-panel as a rolling error rate per connector (`errors / totalCalls` over 7 days). No separate UI page — it's a column in the connector health table in Settings.

---

## Q9 — Settings UI: per-connector toggle or cmd-K skill picker shows only enabled connectors?

**Proposed**: Both, layered. Per-connector toggle in Settings (IA § 6 already specifies this table). cmd-K "Run" section filters available skills by whether their required connectors are enabled.

The Settings connector table (per IA § 6) has an `Enabled` toggle per row. Disabling a connector sets `config.connectors[n].enabled = false`, which prevents its factory from being called at next restart and removes its tools from the MCP server.

The cmd-K skill picker gains a "requires connector" annotation on skill cards. If a skill's required connectors include any that are disabled, the skill is shown with a `⚠ Connector disabled` badge rather than hidden — hiding would confuse users who forgot they disabled a connector. Clicking the badge opens the Settings connector panel directly.

---

## Q10 — Secrets injection: env var at boot, per-call, or constructor receives secrets?

**Proposed**: Constructor (factory function) receives secrets once at init. No env vars; no per-call injection.

The `ConnectorFactory` signature is `(secrets: ConnectorSecrets) => ConnectorPlugin`. `ConnectorSecrets` is a typed map of secret keys to string values, read from `~/.agenticos/secrets.json` by the `ConnectorRegistry` before calling each factory. The factory stores what it needs in closure; tool call handlers capture from that closure.

Env-var injection is tempting for Docker/Daytona compatibility but contradicts the `secrets.json` boundary established in Q2 — you can't have both. Per-call injection (passing secrets to every `handler()` invocation) is unnecessary indirection once the factory pattern is established.

When secrets change (re-auth flow in Settings → "Re-authenticate"), the registry tears down the old connector instance (calling `teardown()` if defined), reads the updated `secrets.json`, and reinitializes that connector's factory without restarting the full dashboard server.

---

## Q11 — Reuse existing MCP servers (Slack, Asana) or implement native connectors?

**Proposed**: Wrap existing MCP servers for Slack and Asana in Phase 5. Implement native connectors for farmOS, Odoo, and Ghost.

**Rationale for wrapping**: Slack and Asana already have production-quality MCP servers running in this workspace. The Claude Code session actively uses them (Slack via `mcp__Instnt__*` and `mcp__Tetrascience__*` tool namespaces; Asana via `mcp__asana__*`). Reimplementing their APIs natively in Phase 5 would duplicate ~thousands of lines of already-tested integration code and introduce a new maintenance surface for API drift.

The wrapper pattern: each `ConnectorPlugin` for Slack and Asana is a thin adapter. Its `ConnectorTool` handlers proxy calls to the local MCP server process via stdio or HTTP (the same transport those MCP servers already use). The AgenticOS `ConnectorRegistry` adds the MCP server process as a child process managed by `packages/connector-core/` — started at boot if the connector is enabled, shut down via `teardown()`.

**Wrapper trade-offs to accept**:
- Tool naming: MCP server tool names (`conversations_history`) get aliased under the AgenticOS namespace (`slack.conversations_history`). A thin mapping table handles this per connector.
- Auth: Slack and Asana MCP servers handle their own OAuth internally. The AgenticOS `secrets.json` stores only the OAuth tokens in a passthrough field for the wrapper to inject at startup — no second auth system.
- Version drift: if the upstream MCP server updates its tool schema, the wrapper's input schema Zod definitions need updating. Low risk at current cadence.

**Rationale for native connectors (farmOS, Odoo, Ghost)**: No MCP servers exist for these. farmOS exposes a JSON:API surface; Odoo uses XML-RPC or REST (version-dependent); Ghost has a well-documented Content API and Admin API. All three are self-hosted at known base URLs, so there's no auth discovery complexity.

Ghost is the simplest: Content API is read-only (API key in query param), Admin API is write-capable (JWT from API key). Implement both.

---

## Q12 — Connector tests: record-and-replay fixtures, pure unit tests, or both?

**Proposed**: Both, with record-and-replay as the primary integration layer.

Pure unit tests cover the `ConnectorPlugin` interface contract (factory returns a valid plugin shape, tool input schemas validate correctly, health check returns the right type). These run fast, need no network, and live in `packages/connectors/<id>/test/unit/`.

Record-and-replay integration tests (using `nock` or `msw` with recorded HTTP cassettes) cover the real API surface — JSON:API shape for farmOS, Ghost Admin JWT signing, Odoo XML-RPC envelope. Cassettes are committed to `packages/connectors/<id>/test/fixtures/`. The recording step runs manually (requires live credentials) and is not part of CI — but replay always runs in CI.

For the Slack and Asana wrappers, tests mock the child MCP server process rather than the upstream APIs (the upstream APIs are already tested by those MCP servers' own test suites).

**Test targets**:

| Layer | Tests | Notes |
|---|---|---|
| `packages/connector-core/` | ~15 | Registry init, health aggregation, secrets parsing, lifecycle (teardown + reinit) |
| `packages/connectors/farmos/` | ~18 | Unit (schema) + record-replay (JSON:API: asset list, log create, sensor read) |
| `packages/connectors/odoo/` | ~15 | Unit + record-replay (partner read, timesheet create, product query) |
| `packages/connectors/ghost/` | ~12 | Unit + record-replay (post draft, publish, content read) |
| `packages/connectors/asana/` | ~10 | Unit + child-process mock (task create, comment, update) |
| `packages/connectors/slack/` | ~10 | Unit + child-process mock (message send, channel history, search) |
| `/api/connectors/*` routes | ~8 | Health route, settings toggle, re-auth flow |

**Phase 5 target**: current test count (from Phase 3 projected ~190) + ~88 new ≈ **~278 tests**.

---

## Proposed Architecture

### Package structure

```
packages/
├── connector-core/              # @agenticos/connector-core
│   ├── src/
│   │   ├── types.ts             # ConnectorPlugin, ConnectorTool, ConnectorSecrets
│   │   ├── registry.ts          # ConnectorRegistry class
│   │   ├── secrets.ts           # read/write ~/.agenticos/secrets.json (atomic)
│   │   ├── health.ts            # healthCheck aggregation + /api/connectors/health
│   │   └── limits.ts            # ConnectorLimitStore (extends lib/limits/)
│   └── test/
│
├── connectors/
│   ├── farmos/                  # native
│   ├── odoo/                    # native
│   ├── ghost/                   # native
│   ├── asana/                   # wrapper (child MCP process)
│   └── slack/                   # wrapper (child MCP process)
```

The MCP server for connector tools runs at `127.0.0.1:7620` — a new port alongside the vault MCP at `127.0.0.1:7610` (Phase 3). Hermes skills that need connector tools are granted access to this port the same way they're granted vault tools.

`ConnectorConfigSchema` in `apps/dashboard/lib/config/schema.ts` is extended:

```ts
export const ConnectorConfigSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  baseUrl: z.string().url().optional(),    // for self-hosted: farmOS, Odoo, Ghost
});
```

---

## Proposed Sequencing

**Wave 1 (T1 — solo)**: `connector-core` package. Registry, secrets store, health aggregation, `ConnectorPlugin` types, `ConnectorTool` MCP registration scaffolding. Heavy unit tests. This is the `vault-core` of Phase 5 — nothing else can start without it.

**Wave 2 (parallel — read-only connectors first)**:
- T5 Ghost CMS connector (native, Admin + Content API). Read-only first: Content API. Write (draft/publish) in same task but behind a flag.
- T6 Slack connector (wrapper). Read-only first: `conversations_history`, `conversations_replies`, `channels_list`.

Ghost and Slack are the simplest auth stories (API key and OAuth wrapper respectively) and expose the most immediate skill value (Ghost publishes farm posts; Slack surfaces Curator-relevant threads). Starting with read-only de-risks the task — if auth wrapping proves more complex than expected, read-only Slack is still shippable.

**Wave 3 (parallel — bidirectional connectors)**:
- T2 farmOS connector (native, JSON:API read + write: assets, logs, sensor observations).
- T3 Odoo connector (native, REST/XML-RPC read + write: partners, timesheets, products).

farmOS and Odoo have more complex auth (OAuth for farmOS; API key + database name for Odoo) and richer schema surfaces. They go in Wave 3 after connector-core is proven.

**Wave 4 (T4 — solo)**: Asana connector (wrapper). Asana is last because its MCP server is the most actively used in existing sessions — wrapping it risks breaking live tooling. Doing it last means Wave 1–3 are proven and the wrapping pattern is well-understood.

**Wave 5 (Settings UI — solo)**: Connector settings panel polish, health chip in Settings table, cmd-K connector-aware skill filtering, re-auth flow. Deferred to its own wave because it depends on all connectors being registered (health checks need real connectors to poll).

```
Wave 1   connector-core package                              (solo, Sonnet)
Wave 2   T5 Ghost + T6 Slack (read-only → write)            (parallel, Sonnet + Haiku)
Wave 3   T2 farmOS + T3 Odoo (bidirectional)                (parallel, Sonnet + Sonnet)
Wave 4   T4 Asana wrapper                                    (solo, Sonnet)
Wave 5   Settings UI + health chips + cmd-K filter          (solo, Haiku)
```

**Estimated wall-clock**: 5–6 sessions (similar to Phase 3's scope; connector-core in Wave 1 is the critical path item).

---

## Risks + Unknowns

1. **Secrets boundary with MCP wrappers (Slack, Asana)**: The existing Slack/Asana MCP servers manage their own auth internally. Phase 5 needs to inject tokens at child process start without leaking them to the AgenticOS process environment (which could expose them in `ps aux` output). Proposed mitigation: pass secrets via stdin on process start (not as CLI args or env vars), using the MCP server's documented config-injection pattern if available, or via a temp file with `chmod 0600` + delete after read.

2. **Odoo version surface**: Odoo's REST API surface varies significantly between Odoo 16, 17, and Community vs Enterprise editions. The self-hosted instance at `erp.goldberrygrove.farm` is a known quantity, but the connector should fail gracefully with a `"unsupported Odoo version"` error rather than silently returning malformed data. Mitigation: version detection in `healthCheck()`.

3. **Rate-limit accumulation across connectors**: Phase 3 tracks Anthropic limits. Phase 5 adds per-connector limits. The projection view (Q6) must account for concurrent skill runs — if the Farm Morning Brief (Ghost write) and Curator (Slack read + Asana write) fire at overlapping times, their combined quota consumption may not be visible to either projection independently. A `combined projection` view is a Phase 6 item; document the gap.

4. **Asana wrapper process management**: If the Asana MCP server child process crashes, the `ConnectorRegistry` must detect it (via process `exit` event), mark the connector `status: "error"`, and surface this in Settings — without taking down the dashboard process. This is a new process-supervision pattern not present in Phase 3 (Hermes daemon supervision is handled externally). The `teardown()` + reinit flow (Q10) must cover crash recovery, not just clean shutdown.

5. **farmOS OAuth token refresh**: farmOS uses OAuth 2.0 with short-lived access tokens. The connector factory receives the current access token from `secrets.json`, but token refresh (using the stored refresh token) must happen transparently in the tool call handler, not require a user re-auth flow every hour. Mitigation: implement a `withAutoRefresh()` wrapper in the farmOS connector that catches 401 responses, refreshes the token, writes the new token back to `secrets.json` atomically (Q2 pattern), and retries the original call once.

6. **Ghost JWT signing**: Ghost Admin API uses JWT tokens derived from an API key. JWT generation is per-request (not a persistent token), so there is no refresh concern — but the JWT library adds a small dependency. Use `jose` (already likely in the workspace) rather than `jsonwebtoken` to stay ESM-compatible.

---

## References

- Information Architecture spec: `docs/information-architecture.md` § 6 (Settings — Connector Configuration table, base URL + auth status + enabled toggle)
- Phase 2 design: `docs/phase-2-design.md` — atomic write pattern (§ 5.1 step 5b: `tmp + rename`), `VaultStore` interface shape (§ 3.3), package structure pattern (§ 3.1)
- Phase 3 brainstorming checkpoint: `docs/phase-3-brainstorming-checkpoint.md` — MCP server pattern § 2 (vault tools exposed via `127.0.0.1:7610`; connectors follow same pattern on `7620`), atomic scheduler writes, rate-limit observability § 4
- Current `ConnectorConfig` schema: `apps/dashboard/lib/config/schema.ts` — `ConnectorConfigSchema { id, enabled }`, `DEFAULT_CONNECTORS` array
- Ghost Content API: <https://ghost.org/docs/content-api/>
- Ghost Admin API: <https://ghost.org/docs/admin-api/>
- farmOS JSON:API: <https://farmos.org/development/api/json-api/>
- Odoo External API: <https://www.odoo.com/documentation/17.0/developer/reference/external_api.html>
- Asana MCP server (in use): `mcp__asana__*` tool namespace (GID-based task/project operations)
- Slack MCP server (in use): `mcp__Instnt__*` and `mcp__Tetrascience__*` tool namespaces
- Phase 3 rate-limit storage: `~/.agenticos/rate-limits.jsonl` — connector limits extend to `~/.agenticos/connector-limits.jsonl`
