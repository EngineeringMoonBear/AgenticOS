# Paperclip API Shape Reference

Derived entirely from vendored source. The live API (`http://10.116.16.2:3100`) was
unreachable. All field citations are file:line references in this repo.

---

## Checklist gate (a)–(g)

### (a) Does the API support server-side bucketing by day for cost charts?

**NO.** The endpoint `GET /companies/:id/costs/by-period` does not exist.

The vendored cost router (`vendor/paperclip/server/src/routes/costs.ts`) defines exactly
two cost endpoints:
- `GET /companies/:id/costs/summary` (line 173)
- `GET /companies/:id/costs/by-agent-model` (line 205)

There is no `by-period` route. The `CostPeriodPoint` interface and `costByPeriod()` method
in client.ts are stubs that will return HTTP 404 in production. The dashboard must build
any time-series view client-side if needed (e.g. from `costSummary` data).

### (b) What fields does `costs/summary` return?

Source: `vendor/paperclip/server/src/services/costs.ts` lines 130–135

```
{
  companyId: string          // company UUID
  spendCents: number         // total spend this billing period
  budgetCents: number        // from company.budgetMonthlyCents
  utilizationPercent: number // (spendCents / budgetCents) * 100
}
```

Fixture: `costs-summary.json`

### (c) What fields does `costs/by-agent-model` return?

Source: `vendor/paperclip/server/src/services/costs.ts` lines 429–451

Each row:
```
{
  agentId:            string
  agentName:          string | null
  provider:           string
  biller:             string | null
  billingType:        string | null
  model:              string
  costCents:          number
  inputTokens:        number
  cachedInputTokens:  number
  outputTokens:       number
}
```

**ABSENT:** No `callCount` / `calls` field. If a "calls" column is needed for the
by-agent-model panel, it is not available from this endpoint.

Fixture: `costs-by-agent-model.json`

### (d) Does `scheduler-heartbeats` expose plugin-job data?

**NO.** The `GET /instance/scheduler-heartbeats` endpoint
(`vendor/paperclip/server/src/routes/agents.ts` line 1722) returns
`InstanceSchedulerHeartbeatAgent[]` whose shape
(`vendor/paperclip/packages/shared/src/types/heartbeat.ts`) contains only:

```
id, companyId, companyName, companyIssuePrefix, agentName, agentUrlKey,
role, title, status, adapterType, intervalSec, heartbeatEnabled,
schedulerActive, lastHeartbeatAt
```

There is **no** `lastPluginJobRun`, `nextPluginJobRun`, `pluginJobStatus`, or any
vault-ingest/pr-triage specific field. Plugin job last-run/next-run data is ABSENT
from this endpoint. The scheduler panel can show heartbeat cadence and liveness but
not plugin task scheduling details.

Fixture: `scheduler-heartbeats.json`

### (e) Does `costs/by-agent-model` include a call count field?

**NO.** See (c) above. The Drizzle select
(`vendor/paperclip/server/src/services/costs.ts` lines 429–451) projects 10 fields,
none of which is a call count. There is no `callCount`, `calls`, or `requestCount` field.

### (f) What does the `/org` endpoint actually return?

It returns a **nested tree**, NOT a flat list with `parentId`.

Route: `vendor/paperclip/server/src/routes/agents.ts` line 1785  
Shape builder: `toLeanOrgNode()` at line 1430:

```typescript
{
  id: String(node.id),
  name: String(node.name),
  role: String(node.role),
  status: String(node.status),
  reports: node.reports.map(toLeanOrgNode),  // recursive
}
```

The A2 guess (`OrgNode` with `type` and `parentId`) was **completely wrong**:
- `type` → does not exist (field is `role`)
- `parentId` → does not exist (children are in `reports[]`, not flattened)

The `/org.svg` endpoint (line 1793) is a separate route that returns SVG.

Fixture: `org.json`

### (g) What A2 interfaces were wrong and how were they corrected?

| Interface | Wrong fields (A2 guess) | Real fields | Source |
|-----------|------------------------|-------------|--------|
| `CostPeriodPoint` | `date`, `costCents` | **ENDPOINT ABSENT** | costs.ts — no by-period route |
| `Issue` | `assignee: string\|null` | `assigneeAgentId: string\|null`, `assigneeUserId: string\|null` | shared/src/types/issue.ts |
| `Routine` | `name`, `schedule`, `nextRunAt` | `title`, `triggers[].cronExpression`, `triggers[].nextRunAt` | shared/src/types/routine.ts |
| `OrgNode` | `type`, `parentId` | `role`, `status`, `reports: OrgNode[]` | server/src/routes/agents.ts:1430 |
| `Approval` | `title`, `requestedBy` | `type` (ApprovalType), `requestedByAgentId`, `requestedByUserId`, `payload` (opaque) | shared/src/types/approval.ts |
| `ActivityItem` | missing `runId` | `runId: string\|null` (added) | db/src/schema/activity_log.ts |

---

## Full endpoint inventory

### Health — `GET /api/health`

Source: `vendor/paperclip/server/src/routes/health.ts`

```json
{
  "status": "ok",
  "version": "string",
  "deploymentMode": "string",
  "deploymentExposure": "string",
  "authReady": true,
  "bootstrapStatus": "string",
  "bootstrapInviteActive": false,
  "features": { "companyDeletionEnabled": true }
}
```

Unhealthy variant: `{ "status": "unhealthy", "version": "...", "error": "database_unreachable" }`

Fixture: `health.json`

### Costs — `GET /api/companies/:id/costs/summary`

See (b) above. Fixture: `costs-summary.json`

### Costs — `GET /api/companies/:id/costs/by-agent-model`

See (c) above. Fixture: `costs-by-agent-model.json`

### Costs — `GET /api/companies/:id/costs/by-period`

**ABSENT — endpoint does not exist.** Fixture: `costs-by-period.json` (contains `null`)

### Heartbeat Runs — `GET /api/companies/:id/heartbeat-runs`

Source: `vendor/paperclip/server/src/services/heartbeat.ts` `heartbeatRunListColumns` (line 1107)

Key fields: `id`, `companyId`, `agentId`, `invocationSource`, `triggerDetail`, `status`,
`startedAt`, `finishedAt`, `error`, `wakeupRequestId`, `exitCode`, `signal`, `usageJson`,
`sessionIdBefore`, `sessionIdAfter`, `logStore`, `logRef`, `logBytes`, `logSha256`,
`logCompressed`, `errorCode`, `externalRunId`, `processPid`, `processGroupId`,
`processStartedAt`, `lastOutputAt`, `lastOutputSeq`, `lastOutputStream`, `lastOutputBytes`,
`retryOfRunId`, `processLossRetryCount`, `scheduledRetryAt`, `scheduledRetryAttempt`,
`scheduledRetryReason`, `livenessState`, `livenessReason`, `continuationAttempt`,
`lastUsefulActionAt`, `nextAction`, `createdAt`, `updatedAt`.

Plus synthesized: `contextSnapshot` (JSON summary), `resultJson` (JSON summary).

Note: `stdoutExcerpt` and `stderrExcerpt` are returned as `NULL` in list responses.

**`error: string | null` IS exposed and populated on failure runs.**
Source: `vendor/paperclip/server/src/db/schema/heartbeat_runs.ts` (`error: text("error")`),
projected in `heartbeatRunListColumns` at `vendor/paperclip/server/src/services/heartbeat.ts:1116`.
Failure paths write real messages, e.g. `"process pid N lost (process_lost); retrying once"` at
`vendor/paperclip/server/src/services/heartbeat.ts:7376`. Null on succeeded/running runs.
Use `run.error` as the PRIMARY error source for failed/timed_out rows; fall back to
`livenessReason` (when `livenessState === "failed"`) only when `run.error` is null.

Fixture: `heartbeat-runs.json` (includes a `timed_out` row with non-null `error`)

### Activity — `GET /api/companies/:id/activity`

Source: `vendor/paperclip/server/src/routes/activity.ts` line 75,
schema at `vendor/paperclip/packages/db/src/schema/activity_log.ts`

Fields: `id`, `companyId`, `actorType`, `actorId`, `action`, `entityType`, `entityId`,
`agentId` (nullable uuid), `runId` (nullable uuid), `details` (jsonb), `createdAt`

Fixture: `activity.json`

### Agents — `GET /api/companies/:id/agents`

Source: `vendor/paperclip/server/src/routes/agents.ts` line 1703

Fixture: `agents.json`

### Org Tree — `GET /api/companies/:id/org`

See (f) above. Returns nested `OrgNode[]` tree. Fixture: `org.json`

### Issues — `GET /api/companies/:id/issues`

See (g) above. Fixture: `issues.json`

### Routines — `GET /api/companies/:id/routines`

See (g) above. Fixture: `routines.json`

### Approvals — `GET /api/companies/:id/approvals`

See (g) above. Payload is redacted via `redactApprovalPayload()` in
`vendor/paperclip/server/src/routes/approvals.ts`. Fixture: `approvals.json`

### Scheduler Heartbeats — `GET /api/instance/scheduler-heartbeats`

See (d) above. Instance-scoped (no companyId in path). Fixture: `scheduler-heartbeats.json`

---

## Valid enum values

### Heartbeat run statuses
Source: `vendor/paperclip/packages/shared/src/constants.ts` line 644
`"queued"` | `"scheduled_retry"` | `"running"` | `"succeeded"` | `"failed"` | `"cancelled"` | `"timed_out"`

### Invocation sources
Source: constants.ts line 621
`"timer"` | `"assignment"` | `"on_demand"` | `"automation"`

### Wakeup trigger details
Source: constants.ts line 629
`"manual"` | `"ping"` | `"callback"` | `"system"`

### Run liveness states
Source: constants.ts line 655
`"completed"` | `"advanced"` | `"plan_only"` | `"empty_response"` | `"blocked"` | `"failed"` | `"needs_followup"`

### Issue statuses
Source: constants.ts line 177
`"backlog"` | `"todo"` | `"in_progress"` | `"in_review"` | `"done"` | `"blocked"` | `"cancelled"`

### Approval statuses
Source: constants.ts line 486
`"pending"` | `"revision_requested"` | `"approved"` | `"rejected"` | `"cancelled"`

### Approval types
Source: constants.ts line 478
`"hire_agent"` | `"approve_ceo_strategy"` | `"budget_override_required"` | `"request_board_approval"`
