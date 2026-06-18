/**
 * Paperclip API read client.
 *
 * Mirrors the Result<T> discriminated-union pattern used in
 * packages/vault-plugin/src/vault-client.ts.
 *
 * Config is passed in at construction time (never read from process.env here).
 * All requests use Board-key auth and an 8-second AbortSignal timeout.
 * No retries — the dashboard polls on its own cadence.
 */

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };
export type Result<T> = Ok<T> | Err;

// ── Config ──────────────────────────────────────────────────────────────────

export interface PaperclipClientConfig {
  /** Base URL of the Paperclip server, e.g. "https://paperclip.example.com" */
  apiUrl: string;
  /** Board API key — sent as `Authorization: Bearer <boardKey>` */
  boardKey: string;
  /** Company ID used in all company-scoped endpoints */
  companyId: string;
}

// ── Response shapes ──────────────────────────────────────────────────────────

export interface CostSummary {
  companyId: string;
  spendCents: number;
  budgetCents: number;
  utilizationPercent: number;
}

export interface CostByAgentModelRow {
  agentId: string;
  agentName: string | null;
  provider: string;
  biller: string | null;
  billingType: string | null;
  model: string;
  costCents: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export interface HeartbeatRun {
  id: string;
  companyId: string;
  agentId: string;
  status: string;
  /** Non-nullable — HeartbeatInvocationSource enum ("timer"|"assignment"|"on_demand"|"automation"). Source: vendor/paperclip/packages/shared/src/types/heartbeat.ts:15 */
  invocationSource: string;
  triggerDetail: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** Per-run error message written on failure (e.g. "process_lost; retrying once").
   *  Populated on failed/timed_out runs; null on success/running.
   *  Source: vendor/paperclip/server/src/db/schema/heartbeat_runs.ts (error text column),
   *  projected in heartbeatRunListColumns at vendor/paperclip/server/src/services/heartbeat.ts:1116 */
  error: string | null;
  createdAt: string;
  livenessState: string | null;
  livenessReason: string | null;
  contextSnapshot: Record<string, unknown> | null;
  resultJson: Record<string, unknown> | null;
}

export interface ActivityItem {
  id: string;
  companyId: string;
  actorType: string;
  actorId: string;
  agentId: string | null;
  /** Present when the activity was generated during a heartbeat run. Source: vendor/paperclip/packages/db/src/schema/activity_log.ts */
  runId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface Agent {
  id: string;
  companyId: string;
  name: string;
  status: string;
  role: string | null;
  title: string | null;
  adapterType: string | null;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  [key: string]: unknown;
}

export interface HealthStatus {
  status: string;
  version?: string;
  deploymentMode?: string;
  [key: string]: unknown;
}

/**
 * ABSENT: The Paperclip API does NOT expose a `GET /companies/:id/costs/by-period`
 * endpoint. The vendored source (vendor/paperclip/server/src/routes/costs.ts) only
 * defines `/costs/summary` and `/costs/by-agent-model`. There is no server-side
 * bucketing by day. The `costByPeriod()` method below is retained as a stub that
 * always returns a 404 error so callers can detect the absence at runtime.
 *
 * @deprecated endpoint does not exist in Paperclip server
 */
export interface CostPeriodPoint {
  /** ISO date string for the start of the bucket, e.g. "2024-01-01" */
  date: string;
  costCents: number;
}

/**
 * Issue shape from vendor/paperclip/packages/shared/src/types/issue.ts
 * Key corrections from A2 guess:
 *   - REMOVED: assignee (does not exist)
 *   - ADDED: assigneeAgentId, assigneeUserId (two separate nullable fields)
 *   - ADDED: identifier, issueNumber, workMode, companyId, priority (real fields)
 *   - ADDED: successfulRunHandoff, activeRecoveryAction (appended by route handler)
 */
export interface Issue {
  id: string;
  companyId: string;
  title: string;
  status: string;
  priority: string | null;
  /** No single assignee field — split into two nullable FK fields. */
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  identifier: string | null;
  issueNumber: number | null;
  workMode: string | null;
  successfulRunHandoff: unknown | null;
  activeRecoveryAction: unknown | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Plugin-managed routine metadata.
 * Source: vendor/paperclip/packages/shared/src/types/routine.ts:79 (RoutineManagedByPlugin)
 */
export interface RoutineManagedByPlugin {
  id: string;
  pluginId: string;
  pluginKey: string;
  pluginDisplayName: string;
  resourceKind: "routine";
  resourceKey: string;
  defaultsJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Trigger sub-shape for RoutineListItem.
 * Source: vendor/paperclip/packages/shared/src/types/routine.ts (RoutineListItem)
 */
export interface RoutineTrigger {
  id: string;
  kind: string;
  label: string | null;
  enabled: boolean;
  /** Cron expression — no top-level `schedule` field on Routine. */
  cronExpression: string | null;
  timezone: string | null;
  nextRunAt: string | null;
  lastFiredAt: string | null;
  lastResult: string | null;
}

export interface RoutineIssueSummary {
  id: string;
  identifier: string | null;
  title: string;
  status: string;
  priority: string;
  updatedAt: string;
}

/**
 * Routine list item shape from vendor/paperclip/packages/shared/src/types/routine.ts
 * Key corrections from A2 guess:
 *   - REMOVED: name (field is `title`), schedule (does not exist), nextRunAt (lives in triggers[])
 *   - ADDED: triggers[], lastRun, activeIssue
 *   - Cron info lives in triggers[].cronExpression and triggers[].nextRunAt
 *
 * Intentionally narrowed to dashboard-relevant fields only; full shape (projectId, goalId,
 * description, variables, env, revision fields, etc.) lives in the vendored Routine type at
 * vendor/paperclip/packages/shared/src/types/routine.ts:51.
 */
export interface Routine {
  id: string;
  companyId: string;
  title: string;
  status: string;
  priority: string | null;
  assigneeAgentId: string | null;
  concurrencyPolicy: string | null;
  catchUpPolicy: string | null;
  lastTriggeredAt: string | null;
  lastEnqueuedAt: string | null;
  /** Plugin that owns this routine, or null if unmanaged. Source: vendor/paperclip/packages/shared/src/types/routine.ts:79 */
  managedByPlugin: RoutineManagedByPlugin | null;
  createdAt: string;
  updatedAt: string;
  /** Cron/webhook triggers — schedule/nextRunAt live here, not on Routine itself. */
  triggers: RoutineTrigger[];
  lastRun: Record<string, unknown> | null;
  activeIssue: RoutineIssueSummary | null;
}

/**
 * Org tree node from vendor/paperclip/server/src/routes/agents.ts `toLeanOrgNode()` (line 1430).
 * Key corrections from A2 guess:
 *   - REMOVED: type (does not exist), parentId (does not exist)
 *   - ADDED: role, status, reports[] (nested tree — NOT flat array with parentId)
 * The `/org` endpoint returns a NESTED TREE, not a flat list.
 */
export interface OrgNode {
  id: string;
  name: string;
  /** Agent role (e.g. "ceo", "ic") — replaces the incorrect `type` field. */
  role: string;
  status: string;
  /** Child nodes — the tree is recursive, not flat. */
  reports: OrgNode[];
}

/**
 * Approval shape from vendor/paperclip/packages/shared/src/types/approval.ts
 * Key corrections from A2 guess:
 *   - REMOVED: title (does not exist), requestedBy (does not exist as a single field)
 *   - ADDED: type (ApprovalType enum), requestedByAgentId, requestedByUserId, payload (opaque/redacted)
 */
export interface Approval {
  id: string;
  companyId: string;
  /** One of: "hire_agent" | "approve_ceo_strategy" | "budget_override_required" | "request_board_approval" */
  type: string;
  requestedByAgentId: string | null;
  requestedByUserId: string | null;
  status: string;
  /** Opaque payload — redacted to "[redacted]" string in API response by redactApprovalPayload(). */
  payload: unknown;
  decisionNote: string | null;
  decidedByUserId: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Scheduler heartbeat agent from vendor/paperclip/packages/shared/src/types/heartbeat.ts
 * (InstanceSchedulerHeartbeatAgent interface, line ~1)
 * NOTE: Does NOT expose plugin-job data (no vault-ingest/pr-triage last-run or next-run).
 */
export interface SchedulerHeartbeatAgent {
  id: string;
  companyId: string;
  companyName: string;
  companyIssuePrefix: string;
  agentName: string;
  agentUrlKey: string | null;
  role: string;
  title: string | null;
  status: string;
  adapterType: string;
  intervalSec: number;
  heartbeatEnabled: boolean;
  schedulerActive: boolean;
  lastHeartbeatAt: string | null;
}

// ── Date-range / param helpers ───────────────────────────────────────────────

export interface DateRangeParams {
  from?: string;
  to?: string;
}

export interface LimitParams {
  limit: number;
}

export interface HeartbeatRunsParams extends LimitParams {
  status?: string;
  agentId?: string;
}

/** @deprecated costByPeriod endpoint does not exist in Paperclip server */
export interface CostByPeriodParams {
  from?: string;
  to?: string;
  bucket?: "day";
}

export interface IssuesParams {
  status?: string;
  limit?: number;
}

export interface ApprovalsParams {
  status?: string;
}

// ── Client ───────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 8_000;

export interface PaperclipClient {
  costSummary(params: DateRangeParams): Promise<Result<CostSummary>>;
  costByAgentModel(params: DateRangeParams): Promise<Result<CostByAgentModelRow[]>>;
  heartbeatRuns(params: HeartbeatRunsParams): Promise<Result<HeartbeatRun[]>>;
  activity(params: LimitParams): Promise<Result<ActivityItem[]>>;
  agents(): Promise<Result<Agent[]>>;
  health(): Promise<Result<HealthStatus>>;
  /** @deprecated endpoint does not exist in Paperclip server — always returns 404 */
  costByPeriod(params: CostByPeriodParams): Promise<Result<CostPeriodPoint[]>>;
  issues(params: IssuesParams): Promise<Result<Issue[]>>;
  routines(): Promise<Result<Routine[]>>;
  org(): Promise<Result<OrgNode[]>>;
  approvals(params: ApprovalsParams): Promise<Result<Approval[]>>;
  /** Instance-level scheduler heartbeat status for all agents across all companies. */
  schedulerHeartbeats(): Promise<Result<SchedulerHeartbeatAgent[]>>;
}

export function createPaperclipClient(cfg: PaperclipClientConfig): PaperclipClient {
  const base = cfg.apiUrl.replace(/\/$/, "");
  const companyBase = `${base}/api/companies/${cfg.companyId}`;
  const authHeader = `Bearer ${cfg.boardKey}`;

  async function fetchJson<T>(url: string): Promise<Result<T>> {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        // Build the base error from the HTTP status so it is never masked by a
        // body-read or JSON-parse failure.
        const baseError = `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`;
        let error = baseError;
        try {
          const text = await res.text();
          if (text) {
            try {
              const json = JSON.parse(text) as { error?: string };
              error = json.error ? `${baseError}: ${json.error}` : `${baseError}: ${text}`;
            } catch {
              error = `${baseError}: ${text}`;
            }
          }
        } catch {
          // Body read failed — keep the HTTP status error as-is.
        }
        return { ok: false, error };
      }
      const json = (await res.json()) as T;
      return { ok: true, data: json };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "paperclip-server unreachable",
      };
    }
  }

  function buildUrl(path: string, params: Record<string, string | undefined>): string {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") qs.set(k, v);
    }
    const queryString = qs.toString();
    return queryString ? `${path}?${queryString}` : path;
  }

  return {
    costSummary({ from, to }: DateRangeParams) {
      const url = buildUrl(`${companyBase}/costs/summary`, { from, to });
      return fetchJson<CostSummary>(url);
    },

    costByAgentModel({ from, to }: DateRangeParams) {
      const url = buildUrl(`${companyBase}/costs/by-agent-model`, { from, to });
      return fetchJson<CostByAgentModelRow[]>(url);
    },

    heartbeatRuns({ limit, status, agentId }: HeartbeatRunsParams) {
      const url = buildUrl(`${companyBase}/heartbeat-runs`, {
        limit: String(limit),
        status,
        agentId,
      });
      return fetchJson<HeartbeatRun[]>(url);
    },

    activity({ limit }: LimitParams) {
      const url = buildUrl(`${companyBase}/activity`, { limit: String(limit) });
      return fetchJson<ActivityItem[]>(url);
    },

    agents() {
      return fetchJson<Agent[]>(`${companyBase}/agents`);
    },

    health() {
      return fetchJson<HealthStatus>(`${base}/api/health`);
    },

    costByPeriod({ from, to, bucket }: CostByPeriodParams) {
      const url = buildUrl(`${companyBase}/costs/by-period`, { from, to, bucket });
      return fetchJson<CostPeriodPoint[]>(url);
    },

    issues({ status, limit }: IssuesParams) {
      const url = buildUrl(`${companyBase}/issues`, {
        status,
        limit: limit !== undefined ? String(limit) : undefined,
      });
      return fetchJson<Issue[]>(url);
    },

    routines() {
      return fetchJson<Routine[]>(`${companyBase}/routines`);
    },

    org() {
      return fetchJson<OrgNode[]>(`${companyBase}/org`);
    },

    approvals({ status }: ApprovalsParams) {
      const url = buildUrl(`${companyBase}/approvals`, { status });
      return fetchJson<Approval[]>(url);
    },

    schedulerHeartbeats() {
      return fetchJson<SchedulerHeartbeatAgent[]>(`${base}/api/instance/scheduler-heartbeats`);
    },
  };
}
