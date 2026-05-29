/**
 * OpenViking read-shim for the Memory tab.
 *
 * Wraps the small set of OpenViking endpoints that the Memory tab's
 * /api/memory/* route handlers need (Phase 4 of the unified dashboard
 * plan). Server-only: never imported by client components. Leaking the
 * internal endpoint URL or API key to the browser would expose Viking
 * to the public internet.
 *
 * Endpoint shapes were verified against
 * docs/reference/openviking-v0.3.19-openapi.json on 2026-05-28. Real Viking
 * uses `uri` (not `path`), `content/{abstract,overview,read}` (not bare
 * `/abstract`), requires `Authorization: Bearer …`, `X-OpenViking-Account`,
 * and `X-OpenViking-User` on every request, and `cache: "no-store"` to keep
 * the dashboard from serving stale memory state.
 */
import "server-only";

const ENDPOINT = process.env.OPENVIKING_ENDPOINT ?? "http://openviking:1933";
const API_KEY = process.env.OPENVIKING_API_KEY ?? "";
const ACCOUNT = process.env.OPENVIKING_ACCOUNT ?? "agenticos";
const USER = process.env.OPENVIKING_USER ?? "deploy";

// ---------- Types ----------

export interface TreeNode {
  name?: string;
  uri?: string;
  type?: "file" | "dir" | string;
  children?: TreeNode[];
  [k: string]: unknown;
}

export interface FsEntry {
  name?: string;
  uri?: string;
  type?: "file" | "dir" | string;
  [k: string]: unknown;
}

export interface Abstract {
  uri?: string;
  abstract?: string;
  [k: string]: unknown;
}

export interface Overview {
  uri?: string;
  overview?: string;
  [k: string]: unknown;
}

export interface Detail {
  uri?: string;
  content?: string;
  offset?: number;
  limit?: number;
  /**
   * Total bytes available for this resource. `total_offset` is the canonical
   * name from OpenViking v0.3.19's `/api/v1/content/read` response; `total`
   * is kept as an alias for older fixtures. Pagination computes
   * `hasNext = offset + limit < (total_offset ?? total ?? 0)`.
   */
  total_offset?: number;
  total?: number;
  [k: string]: unknown;
}

export interface Retrieval {
  events?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

// ---------- Internals ----------

function tenantHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${API_KEY}`,
    "X-OpenViking-Account": ACCOUNT,
    "X-OpenViking-User": USER,
    ...(extra ?? {}),
  };
}

async function vget<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const url = new URL(`${ENDPOINT}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: tenantHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenViking GET ${path} → ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

async function vpost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${ENDPOINT}${path}`, {
    method: "POST",
    headers: tenantHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenViking POST ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// ---------- Exports ----------

export function vikingFsTree(uri: string): Promise<TreeNode> {
  return vget<TreeNode>("/api/v1/fs/tree", { uri });
}

export function vikingFsLs(uri: string): Promise<{ entries?: FsEntry[] } & Record<string, unknown>> {
  return vget("/api/v1/fs/ls", { uri, simple: "true" });
}

export function vikingAbstract(uri: string): Promise<Abstract> {
  return vget<Abstract>("/api/v1/content/abstract", { uri });
}

export function vikingOverview(uri: string): Promise<Overview> {
  return vget<Overview>("/api/v1/content/overview", { uri });
}

export function vikingDetail(uri: string, offset = 0, limit = 8192): Promise<Detail> {
  return vget<Detail>("/api/v1/content/read", { uri, offset, limit });
}

export function vikingRetrieval(): Promise<Retrieval> {
  return vget<Retrieval>("/api/v1/observer/retrieval");
}

/**
 * Materializes a relations graph: reads from `space_uris`, writes the
 * computed graph to `output_uri`. Side-effecting / write op — not a
 * query. The dashboard's Memory trajectory view should derive its data
 * from `vikingRetrieval()` events, NOT from this endpoint.
 */
export function vikingBuildGraph(
  space_uris: string[],
  output_uri: string,
): Promise<Record<string, unknown>> {
  return vpost<Record<string, unknown>>("/api/v1/relations/build_graph", {
    space_uris,
    output_uri,
  });
}

export function vikingSearchFind(
  query: string,
  target_uri?: string,
): Promise<{ results?: Array<Record<string, unknown>> } & Record<string, unknown>> {
  const body: Record<string, unknown> = { query };
  if (target_uri !== undefined) body.target_uri = target_uri;
  return vpost("/api/v1/search/find", body);
}

export function vikingStatsMemories(
  category?: string,
): Promise<Record<string, unknown>> {
  return vget("/api/v1/stats/memories", category ? { category } : undefined);
}

export function vikingDashboardSummary(tz: string): Promise<Record<string, unknown>> {
  return vget("/api/v1/console/dashboard/summary", { timezone: tz });
}
