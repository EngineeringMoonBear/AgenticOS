import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Inbound leg: GitHub → Paperclip. A GitHub Actions workflow POSTs an
 * issue-opened payload to the plugin's public webhook endpoint
 * (`/api/plugins/:id/webhooks/github-issue`); `onWebhook` verifies the HMAC,
 * then creates the mirror Paperclip issue directly via `ctx.issues.create`
 * (agent-free — routines can't do this because every run requires an agent).
 *
 * The created issue carries the `synced-from-github` marker, so the plugin's
 * existing `issue.created` handler records the mapping and does NOT bounce it
 * back to GitHub — the loop-prevention contract is reused, not duplicated.
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
 */
export function verifyGithubSignature(
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

export interface InboundPayload {
  /** "owner/name" */
  repo: string;
  number: number;
  title: string;
  body: string;
  url: string;
}

/** Parse + validate the GitHub-issue-opened webhook payload. Null if invalid. */
export function parseInboundPayload(raw: unknown): InboundPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const repo = typeof o.repo === "string" ? o.repo : "";
  const number = typeof o.number === "number" ? o.number : Number(o.number);
  const title = typeof o.title === "string" ? o.title : "";
  if (!repo || !Number.isFinite(number) || number <= 0 || !title) return null;
  return {
    repo,
    number,
    title,
    body: typeof o.body === "string" ? o.body : "",
    url: typeof o.url === "string" ? o.url : "",
  };
}

/**
 * Native GitHub App `issues` webhook event (the Option-B path). GitHub delivers
 * one signed POST per issue action to the App's single webhook URL, covering
 * EVERY installed repo — so no per-repo Actions workflow or repo secret is
 * needed. Shape: `{ action, issue: { number, title, body, html_url, labels }, repository: { full_name } }`.
 */
export interface GithubIssueEvent {
  /** e.g. "opened", "edited", "closed" — only "opened" is mirrored. */
  action: string;
  /** Label names on the issue, used for the outbound loop guard. */
  labels: string[];
  payload: InboundPayload;
}

/**
 * Parse GitHub's native `issues` event webhook body into our InboundPayload.
 * Returns null if it isn't a usable issue event. Unlike the custom endpoint,
 * `repo` comes from `repository.full_name` and the fields live under `issue`.
 */
export function parseGithubAppIssueEvent(raw: unknown): GithubIssueEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const action = typeof o.action === "string" ? o.action : "";
  const repository = (o.repository ?? {}) as Record<string, unknown>;
  const issue = (o.issue ?? {}) as Record<string, unknown>;

  const repo = typeof repository.full_name === "string" ? repository.full_name : "";
  const number = typeof issue.number === "number" ? issue.number : Number(issue.number);
  const title = typeof issue.title === "string" ? issue.title : "";
  if (!repo || !Number.isFinite(number) || number <= 0 || !title) return null;

  const rawLabels = Array.isArray(issue.labels) ? issue.labels : [];
  const labels = rawLabels
    .map((l) => (l && typeof l === "object" ? (l as Record<string, unknown>).name : l))
    .filter((n): n is string => typeof n === "string");

  return {
    action,
    labels,
    payload: {
      repo,
      number,
      title,
      body: typeof issue.body === "string" ? issue.body : "",
      url: typeof issue.html_url === "string" ? issue.html_url : "",
    },
  };
}

/**
 * The GitHub→Paperclip marker. MUST stay compatible with sync.ts's
 * `detectGithubMarker` regex `/<!--\s*synced-from-github:\s*([^\s#]+)#(\d+)\s*-->/i`
 * so the outbound handler recognises inbound-origin issues and skips the bounce.
 */
export function githubMarker(repo: string, num: number): string {
  return `<!-- synced-from-github: ${repo}#${num} -->`;
}

/** Build the mirror issue's description from the inbound payload. */
export function buildInboundDescription(p: InboundPayload): string {
  return `${githubMarker(p.repo, p.number)}\n\n${p.body}\n\n---\nSynced from GitHub: ${p.url}`;
}

/** Facts about a freshly-created mirror, used to build the ops-visibility ping. */
export interface MirrorOpsInfo {
  repo: string;
  number: number;
  title: string;
  url: string;
  projectId: string;
  issueId: string;
  /** The agent the mirror was assigned to, if default routing was configured. */
  assigneeAgentId?: string;
  /**
   * The label that routed this mirror (v0.6.0 `labelRouting`), if any. Makes the
   * routing decision visible in the ops channel (spec System 3: state-change pings).
   */
  routedByLabel?: string;
  /** True when the mirror fell back to the triage owner (no routing label matched). */
  routedByFallback?: boolean;
}

/**
 * Build the Discord ops-webhook message body for a newly-created mirror issue.
 * Pure (no I/O) so it is unit-testable. When no assignee is configured we make
 * the gap loud — an unassigned mirror never enters an agent heartbeat (heartbeat
 * rule #1), which is exactly the silent-pileup failure GOL-80 exists to close.
 *
 * When the mirror was routed by a discipline label (v0.6.0) the message names the
 * label; when it fell back to triage it says so — a low-noise, state-change-only
 * ping (spec System 3).
 */
export function buildMirrorOpsMessage(info: MirrorOpsInfo): string {
  const via = info.routedByLabel
    ? ` via label \`${info.routedByLabel}\``
    : info.routedByFallback
      ? " (fallback triage — no routing label)"
      : "";
  const who = info.assigneeAgentId
    ? `assigned → \`${info.assigneeAgentId}\`${via}`
    : "⚠️ UNASSIGNED — set the bridge's `labelRouting`/`fallbackAssigneeAgentId` (or `defaultAssigneeAgentId`) so it gets picked up";
  const link = info.url ? ` (<${info.url}>)` : "";
  return (
    `🔁 GitHub → Paperclip mirror created: **${info.title}** ` +
    `[${info.repo}#${info.number}]${link} — ${who} ` +
    `in project \`${info.projectId}\` · issue \`${info.issueId}\``
  );
}
