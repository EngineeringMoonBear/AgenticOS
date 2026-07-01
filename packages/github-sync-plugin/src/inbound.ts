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
