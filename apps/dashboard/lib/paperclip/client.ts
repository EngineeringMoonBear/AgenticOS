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
  invocationSource: string | null;
  triggerDetail: string | null;
  startedAt: string | null;
  finishedAt: string | null;
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

// ── Client ───────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 8_000;

export interface PaperclipClient {
  costSummary(params: DateRangeParams): Promise<Result<CostSummary>>;
  costByAgentModel(params: DateRangeParams): Promise<Result<CostByAgentModelRow[]>>;
  heartbeatRuns(params: HeartbeatRunsParams): Promise<Result<HeartbeatRun[]>>;
  activity(params: LimitParams): Promise<Result<ActivityItem[]>>;
  agents(): Promise<Result<Agent[]>>;
  health(): Promise<Result<HealthStatus>>;
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
  };
}
