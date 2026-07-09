/**
 * Label-based discipline routing (plugin v0.6.0 — GOL-150, spec
 * docs/superpowers/specs/2026-07-08-discipline-routing-agent-pr-review-design.md).
 *
 * A bridge maps GitHub label names → Paperclip agent ids (`labelRouting`). When an
 * inbound mirror carries a routing label we assign it to that discipline's owner so
 * it enters the right agent's heartbeat immediately; otherwise it falls back to a
 * triage owner (`fallbackAssigneeAgentId`, e.g. the CEO). Deterministic — no LLM
 * classifier (one may be layered on later for unlabeled issues).
 *
 * Fixed precedence (spec, do NOT re-litigate): `infra` = `bug` = `alert` > `frontend`
 * > `feature`. "First match by precedence wins." The three top-tier labels all route
 * to the same owner (DevOps), so ties within the top tier are irrelevant.
 */

/** label name -> assigneeAgentId. */
export type LabelRouting = Record<string, string>;

/**
 * Precedence tiers, highest priority first. A label not named in any tier ranks
 * after every named tier (still routable, just lowest priority among matches).
 */
export const PRECEDENCE_TIERS: readonly (readonly string[])[] = [
  ["infra", "bug", "alert"],
  ["frontend"],
  ["feature"],
];

export interface RoutingInput {
  /** label name -> assigneeAgentId (v0.6.0). */
  labelRouting?: LabelRouting;
  /** Assignee when no routing label matches (v0.6.0 — e.g. CEO triage). */
  fallbackAssigneeAgentId?: string;
  /** Backward-compatible pre-v0.6.0 single default assignee. */
  defaultAssigneeAgentId?: string;
}

export type RoutingReason = "label" | "fallback" | "default" | "none";

export interface RoutingResult {
  /** The resolved assignee, or undefined when nothing is configured. */
  assigneeAgentId?: string;
  /** The label that decided the assignment, when routed by label. */
  matchedLabel?: string;
  /** How the assignee was chosen — for ops pings and logs. */
  reason: RoutingReason;
}

/** Rank a routing key by precedence tier (lower = higher priority). Unknown → last. */
function tierRank(label: string): number {
  const l = label.toLowerCase();
  for (let i = 0; i < PRECEDENCE_TIERS.length; i++) {
    const tier = PRECEDENCE_TIERS[i];
    if (tier && tier.includes(l)) return i;
  }
  return PRECEDENCE_TIERS.length;
}

/**
 * Resolve the assignee for an inbound mirror from its GitHub labels.
 *
 * Resolution order (spec System 1):
 *   1. Best `labelRouting` match by precedence (first match by precedence wins).
 *   2. `fallbackAssigneeAgentId` (triage owner).
 *   3. `defaultAssigneeAgentId` (backward compatible — existing config keeps working).
 *
 * Case-insensitive on label names. Returns the reason so callers can build a
 * state-change ops ping and structured logs.
 */
export function resolveRouting(cfg: RoutingInput, labels: readonly string[]): RoutingResult {
  const routing = cfg.labelRouting;
  if (routing) {
    const present = new Set(labels.map((l) => l.toLowerCase()));
    // Only routing keys that are actually on the issue are candidates.
    const candidates = Object.keys(routing).filter((k) => present.has(k.toLowerCase()));
    // Lowest tier rank wins; Array.prototype.sort is stable (Node ≥ 22), so
    // within a tier the configured key order breaks ties deterministically.
    candidates.sort((a, b) => tierRank(a) - tierRank(b));
    const key = candidates[0];
    if (key !== undefined) {
      return { assigneeAgentId: routing[key], matchedLabel: key, reason: "label" };
    }
  }
  if (cfg.fallbackAssigneeAgentId) {
    return { assigneeAgentId: cfg.fallbackAssigneeAgentId, reason: "fallback" };
  }
  if (cfg.defaultAssigneeAgentId) {
    return { assigneeAgentId: cfg.defaultAssigneeAgentId, reason: "default" };
  }
  return { reason: "none" };
}
