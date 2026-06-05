/**
 * OpenViking memory client.
 *
 * Hits the OpenViking server running on the Droplet (default `http://openviking:1933`
 * on the docker-compose network, or `http://127.0.0.1:1933` when SSH-tunneled).
 *
 * Verified contract (see docs/superpowers/specs/spec1-verified-api-shapes.md §4):
 *   - All `/api/v1/*` endpoints require `Authorization: Bearer <root_api_key>`.
 *   - `/health` is auth-free (server liveness check).
 *   - Semantic search is `POST /api/v1/search/find`, NOT `/search` as earlier
 *     plan drafts suggested. The plan was updated after the spike.
 *
 * The root API key is generated at first cloud-init boot and lives in
 * `/opt/agenticos/.env` as `OPENVIKING_ROOT_API_KEY`. The dashboard reads
 * the same key from its own env so both Hermes and the dashboard hit the
 * same OpenViking instance with the same credentials.
 */
import "server-only";

export interface MemoryResult {
  /** OpenViking-assigned memory id (UUID or path-derived). */
  id: string;
  /** Best-effort text excerpt of the memory; may be the abstract, not the full content. */
  text: string;
  /** Similarity score from OpenViking's hybrid retrieval (higher = more relevant). */
  score: number;
  /** Arbitrary memory metadata (source path, mime, timestamps, etc.). */
  metadata?: Record<string, unknown>;
}

export interface SearchInput {
  query: string;
  /** Cap on results. OpenViking's default is server-side; we pass 10 if unspecified. */
  top_k?: number;
}

export class OpenVikingClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {
    if (!baseUrl) throw new Error("OpenVikingClient: baseUrl is required");
    if (!apiKey) throw new Error("OpenVikingClient: apiKey is required");
  }

  /** Semantic search over the vault's memories. Calls POST /api/v1/search/find. */
  async search(input: SearchInput): Promise<MemoryResult[]> {
    const res = await fetch(`${this.baseUrl}/api/v1/search/find`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        query: input.query,
        top_k: input.top_k ?? 10,
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `OpenViking /api/v1/search/find → ${res.status}: ${body.slice(0, 200)}`,
      );
    }

    const data = (await res.json()) as { results?: MemoryResult[] };
    return data.results ?? [];
  }
}

export function getOpenVikingClient(): OpenVikingClient {
  // App Platform injects OPENVIKING_ENDPOINT/OPENVIKING_API_KEY (matching the
  // Hermes plugin convention; see app-platform.tf). Fall back to the older
  // OPENVIKING_URL/OPENVIKING_ROOT_API_KEY names for local dev.
  const baseUrl = process.env.OPENVIKING_ENDPOINT ?? process.env.OPENVIKING_URL;
  const apiKey = process.env.OPENVIKING_API_KEY ?? process.env.OPENVIKING_ROOT_API_KEY;
  if (!baseUrl) throw new Error("OPENVIKING_URL not set");
  if (!apiKey) throw new Error("OPENVIKING_ROOT_API_KEY not set");
  return new OpenVikingClient(baseUrl, apiKey);
}
