/**
 * GroveAssetsClient — the bundle-safe HTTP binding for GOL-92's optimize/upload seams.
 *
 * WHY HTTP (not an in-process `import "@grove/assets"`):
 * The discord-plugin worker runs as a single esbuild-bundled `dist/worker.js` in a
 * sandbox with NO runtime `node_modules` (see docs/runbooks/paperclip-local-plugin-install.md:
 * manifest/worker must be standalone bundles, mount is read-only). esbuild inlines
 * pure-JS deps (aws-sdk) but CANNOT bundle grove-sites `@grove/assets`, because its
 * ADR-009 optimize recipe depends on the native `sharp` binary — which has nowhere to
 * resolve at runtime in the sandbox. So the recipe stays server-side (ADR-009's
 * "one optimize pipeline"), and this client calls it over `http.outbound` — the same
 * pattern every other AgenticOS plugin uses (discord-client, github-client, …).
 *
 * The server endpoint wraps `@grove/assets`:
 *   - POST {base}/optimize     → runs upload-asset.ts, returns { cdnUrl, key }
 *   - POST {base}/brand-entry  → optimize + opens the `@grove/brand` PR, returns { prUrl }
 * grove-assets Spaces creds live at the endpoint (per-agent secret / broker, ADR-0001),
 * never in this sandboxed worker.
 */
import type { Result } from "../types.js";
import type { AssetPipeline, AssetBrand } from "./job.js";

export interface GroveAssetsClientConfig {
  /** Base URL of the grove-sites optimize service, e.g. https://assets-svc.gatheringatthegrove.com */
  baseUrl: string;
  /** Shared bearer token authorizing this plugin to call the optimize endpoint. */
  token: string;
  timeoutMs?: number;
}

/** Backs both GOL-92 injected seams (`AssetPipeline` + `AssetBrand`) with one HTTP service. */
export class GroveAssetsClient implements AssetPipeline, AssetBrand {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(cfg: GroveAssetsClientConfig) {
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, "");
    this.token = cfg.token;
    this.timeoutMs = cfg.timeoutMs ?? 60_000; // optimize can be slow (multi-format, multi-width)
  }

  async optimizeAndUpload(input: {
    bytes: Uint8Array;
    filename: string;
    brand: string;
    assetClass: string;
    slug: string;
  }): Promise<{ cdnUrl: string; key: string }> {
    const res = await this.post<{ cdnUrl: string; key: string }>("/optimize", input);
    if (!res.ok) throw new Error(`optimize failed: ${res.error}`);
    if (!res.data.cdnUrl || !res.data.key) throw new Error("optimize returned no cdnUrl/key");
    return { cdnUrl: res.data.cdnUrl, key: res.data.key };
  }

  async proposeBrandEntry(input: {
    brand: string;
    slug: string;
    cdnUrl: string;
    key: string;
    caption: string;
  }): Promise<{ prUrl: string }> {
    const res = await this.post<{ prUrl: string }>("/brand-entry", input);
    if (!res.ok) throw new Error(`brand-entry failed: ${res.error}`);
    if (!res.data.prUrl) throw new Error("brand-entry returned no prUrl");
    return { prUrl: res.data.prUrl };
  }

  /**
   * POST as multipart/form-data: `meta` (JSON) + optional `file` (raw bytes). FormData/Blob
   * are Node 22 globals (bundle-safe — no native module), so binary uploads need no base64 bloat.
   */
  private async post<T>(path: string, payload: Record<string, unknown>): Promise<Result<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const { bytes, ...meta } = payload as { bytes?: Uint8Array } & Record<string, unknown>;
      const form = new FormData();
      form.set("meta", JSON.stringify(meta));
      // Copy into a fresh ArrayBuffer-backed view so the Blob part type is exact (not ArrayBufferLike).
      if (bytes) form.set("file", new Blob([new Uint8Array(bytes)]), String(meta.filename ?? "asset"));
      const resp = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${this.token}` },
        body: form,
      });
      const json = (await resp.json().catch(() => ({}))) as T & { error?: string };
      if (!resp.ok) return { ok: false, error: json.error ?? `HTTP ${resp.status}` };
      return { ok: true, data: json };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "optimize service unreachable" };
    } finally {
      clearTimeout(timer);
    }
  }
}
