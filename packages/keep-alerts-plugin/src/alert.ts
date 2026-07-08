import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Inbound leg: Keep → Paperclip. A Keep **workflow action** (not the Discord
 * channel) POSTs an HMAC-signed alert payload to this plugin's public webhook
 * endpoint (`/api/plugins/:id/webhooks/keep-alert`). Keep already owns dedup,
 * fingerprints and severity, so we tap it directly and mint a Paperclip issue
 * keyed by the alert **fingerprint**: re-fires update the existing issue with a
 * comment (never duplicate), and a Keep resolution posts a closing comment.
 *
 * This mirrors the github-sync-plugin inbound contract (HMAC-verified, agent-free
 * `ctx.issues.create`) rather than the Discord channel-scrape approach — the
 * severity gate and fingerprint keying are the only Keep-specific additions.
 *
 * The POST rides the existing Cloudflare Access service-token path (the Keep
 * action sends `CF-Access-Client-Id` / `CF-Access-Client-Secret` so CF admits it
 * to the public endpoint). CF Access is transport-level admission only; the HMAC
 * below is the application-level authenticity check the plugin actually enforces.
 */

/** Case-insensitive single-value header lookup (headers may be arrays). */
export function getHeader(
  headers: Record<string, string | string[]>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

/**
 * Verify a GitHub-style HMAC-SHA256 signature over the exact raw body.
 * Header form: `sha256=<hex>`. Constant-time comparison.
 *
 * We deliberately reuse the exact `X-Hub-Signature-256: sha256=<hex>` scheme the
 * github-sync-plugin uses so Keep's webhook action can sign identically and the
 * whole fleet shares one signing convention.
 */
export function verifyKeepSignature(
  rawBody: string,
  secret: string,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader || !secret) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Keep severities, most→least severe. Matches Keep's AlertDto severity ladder. */
export type Severity = "critical" | "high" | "warning" | "info" | "low";
const SEVERITIES: readonly Severity[] = ["critical", "high", "warning", "info", "low"];

/** Paperclip issue priorities (mirrors Issue["priority"] without importing it). */
export type IssuePriority = "critical" | "high" | "medium" | "low";

/**
 * The default severity gate (D of the grill): critical/warning mint issues; info
 * stays Discord-only. We also mint `high` — Keep's ladder places `high` ABOVE
 * `warning`, so gating it out would silently drop the second-most-severe class.
 * `low` is treated like `info` (Discord-only). Operators can override via config.
 */
export const DEFAULT_MINT_SEVERITIES: readonly Severity[] = ["critical", "high", "warning"];

/** Normalise an arbitrary severity string to a known Severity ("warning" if unknown). */
export function normalizeSeverity(raw: unknown): Severity {
  const s = typeof raw === "string" ? raw.toLowerCase().trim() : "";
  return (SEVERITIES as readonly string[]).includes(s) ? (s as Severity) : "warning";
}

/** Map a Keep severity to a Paperclip issue priority for the minted issue. */
export function severityToPriority(sev: Severity): IssuePriority {
  switch (sev) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "warning":
      return "medium";
    default:
      return "low";
  }
}

/**
 * A parsed, normalised Keep alert. We accept the common Keep AlertDto fields but
 * stay lenient — the Keep workflow action templates the body, so field presence
 * varies. `fingerprint` and `name` are the only hard requirements.
 */
export interface KeepAlert {
  /** Keep's dedup key. THE mint key — one Paperclip issue per fingerprint. */
  fingerprint: string;
  name: string;
  severity: Severity;
  /** true when Keep reports the alert resolved (status === "resolved"). */
  resolved: boolean;
  /** Raw Keep status string, preserved for the comment/description. */
  status: string;
  description: string;
  /** Alert source systems (e.g. ["prometheus"]) — used for ownership routing. */
  source: string[];
  service: string;
  environment: string;
  url: string;
  /** Free-form Keep labels — also fed into ownership routing. */
  labels: Record<string, string>;
}

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string" && v) return [v];
  return [];
}

function toStringMap(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") out[k] = val;
    else if (val != null && (typeof val === "number" || typeof val === "boolean")) out[k] = String(val);
  }
  return out;
}

/**
 * Parse + validate a Keep alert webhook payload. Returns null if it lacks the
 * fingerprint or name that keying/minting require. Accepts `name` or `title`,
 * and `url` or `generatorURL`, to match the fields Keep exposes in templates.
 */
export function parseKeepAlert(raw: unknown): KeepAlert | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const fingerprint = typeof o.fingerprint === "string" ? o.fingerprint.trim() : "";
  const name =
    typeof o.name === "string" && o.name.trim()
      ? o.name.trim()
      : typeof o.title === "string"
        ? o.title.trim()
        : "";
  if (!fingerprint || !name) return null;

  const status = typeof o.status === "string" ? o.status.toLowerCase().trim() : "firing";
  const url =
    typeof o.url === "string" && o.url
      ? o.url
      : typeof o.generatorURL === "string"
        ? o.generatorURL
        : "";

  return {
    fingerprint,
    name,
    severity: normalizeSeverity(o.severity),
    resolved: status === "resolved",
    status: status || "firing",
    description: typeof o.description === "string" ? o.description : "",
    source: toStringArray(o.source),
    service: typeof o.service === "string" ? o.service : "",
    environment: typeof o.environment === "string" ? o.environment : "",
    url,
    labels: toStringMap(o.labels),
  };
}

/** True when this severity should mint/track a Paperclip issue (else Discord-only). */
export function shouldMint(sev: Severity, mintSeverities: readonly Severity[]): boolean {
  return mintSeverities.includes(sev);
}

/**
 * One ownership rule (D2 of the grill). `match` is compared case-insensitively as
 * a substring against the alert's routing tokens (source, service, environment,
 * name, and every label key=value). First matching rule wins → the issue is
 * assigned to `assigneeAgentId` and, optionally, minted into `projectId`.
 */
export interface OwnershipRule {
  match: string;
  assigneeAgentId: string;
  projectId?: string;
}

/** Build the lowercase token string an ownership rule's `match` is tested against. */
export function routingTokens(alert: KeepAlert): string {
  const parts = [
    alert.name,
    alert.service,
    alert.environment,
    ...alert.source,
    ...Object.entries(alert.labels).map(([k, v]) => `${k}=${v}`),
  ];
  return parts.join("  ").toLowerCase();
}

export interface RoutingResult {
  assigneeAgentId?: string;
  projectId?: string;
  /** The rule's `match` that decided routing, or undefined if the default was used. */
  matchedBy?: string;
}

/**
 * Resolve where a minted alert issue goes. Walks the ownership rules in order and
 * returns the first whose `match` token appears in the alert's routing tokens;
 * falls back to no rule (the caller supplies default assignee/project).
 */
export function resolveOwnership(alert: KeepAlert, rules: readonly OwnershipRule[]): RoutingResult {
  const tokens = routingTokens(alert);
  for (const rule of rules) {
    const needle = rule.match.trim().toLowerCase();
    if (needle && tokens.includes(needle)) {
      return { assigneeAgentId: rule.assigneeAgentId, projectId: rule.projectId, matchedBy: rule.match };
    }
  }
  return {};
}

/** Stable marker embedded in the minted issue's description (audit + grep). */
export function keepMarker(fingerprint: string): string {
  return `<!-- keep-alert-fingerprint: ${fingerprint} -->`;
}

/** Build the minted issue's description from the first firing of an alert. */
export function buildIssueDescription(alert: KeepAlert): string {
  const lines: string[] = [
    keepMarker(alert.fingerprint),
    "",
    `**Keep alert:** ${alert.name}`,
    `**Severity:** ${alert.severity}`,
    `**Status:** ${alert.status}`,
  ];
  if (alert.service) lines.push(`**Service:** ${alert.service}`);
  if (alert.environment) lines.push(`**Environment:** ${alert.environment}`);
  if (alert.source.length) lines.push(`**Source:** ${alert.source.join(", ")}`);
  if (alert.description) lines.push("", alert.description);
  const labelEntries = Object.entries(alert.labels);
  if (labelEntries.length) {
    lines.push("", "**Labels:**", ...labelEntries.map(([k, v]) => `- \`${k}\`: ${v}`));
  }
  lines.push("", `**Fingerprint:** \`${alert.fingerprint}\``);
  if (alert.url) lines.push(`**Alert:** ${alert.url}`);
  return lines.join("\n");
}

/** Comment body for a re-fire of an already-open alert issue (Nth occurrence). */
export function buildRefireComment(alert: KeepAlert, occurrence: number): string {
  const detail = alert.description ? `\n\n${alert.description}` : "";
  const link = alert.url ? ` ([alert](${alert.url}))` : "";
  return (
    `🔁 **Keep alert re-fired** — occurrence #${occurrence} ` +
    `(severity: ${alert.severity}, status: ${alert.status})${link}.${detail}`
  );
}

/** Comment body when an alert recurs AFTER it was resolved (flap → reopen). */
export function buildRecurrenceComment(alert: KeepAlert, occurrence: number): string {
  const link = alert.url ? ` ([alert](${alert.url}))` : "";
  return (
    `⚠️ **Keep alert recurred after resolution** — reopened, occurrence #${occurrence} ` +
    `(severity: ${alert.severity})${link}. The condition Keep previously marked resolved is firing again.`
  );
}

/** Comment body for a Keep resolution — posted as the issue is closed. */
export function buildResolutionComment(alert: KeepAlert, occurrences: number): string {
  const link = alert.url ? ` ([alert](${alert.url}))` : "";
  return (
    `✅ **Keep alert resolved**${link}. Closing this issue after ${occurrences} ` +
    `occurrence${occurrences === 1 ? "" : "s"}. Keep will re-open it (new comment) if the alert fires again.`
  );
}

/** Facts about a mint/route decision, used to build the Discord ops ping. */
export interface OpsPingInfo {
  kind: "created" | "refired" | "recurred" | "resolved" | "skipped";
  name: string;
  severity: Severity;
  fingerprint: string;
  issueId?: string;
  assigneeAgentId?: string;
  matchedBy?: string;
  reason?: string;
}

/** Build the best-effort Discord ops-webhook `{content}` for an alert action. */
export function buildOpsPing(info: OpsPingInfo): string {
  const who = info.assigneeAgentId ? `→ \`${info.assigneeAgentId}\`` : "⚠️ UNASSIGNED (no ownership rule / default)";
  const route = info.matchedBy ? ` [rule: ${info.matchedBy}]` : "";
  switch (info.kind) {
    case "created":
      return `🚨 Keep → Paperclip issue minted: **${info.name}** (${info.severity}) ${who}${route} · issue \`${info.issueId}\``;
    case "refired":
      return `🔁 Keep alert re-fired: **${info.name}** (${info.severity}) · issue \`${info.issueId}\``;
    case "recurred":
      return `⚠️ Keep alert recurred after resolution — reopened: **${info.name}** (${info.severity}) · issue \`${info.issueId}\``;
    case "resolved":
      return `✅ Keep alert resolved — closed: **${info.name}** · issue \`${info.issueId}\``;
    case "skipped":
      return `🔕 Keep alert below mint gate (Discord-only): **${info.name}** (${info.severity})${info.reason ? ` — ${info.reason}` : ""}`;
  }
}
