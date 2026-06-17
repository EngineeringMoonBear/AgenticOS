import { createHash } from "node:crypto";
import type { VaultFile } from "./reconcile.js";

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };
export type Result<T> = Ok<T> | Err;

// Re-export VaultFile so Task 2.3 can import from a single place.
export type { VaultFile };

interface TreeResponse {
  tree: unknown;
  flatPaths: string[];
}

interface PageResponse {
  path: string;
  title: string;
  content: string;
  frontmatter: Record<string, unknown>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Returns true when a vault path should be ingested.
 *
 * Exclusion rules (mirrors walk_vault / _walk_dir in vault_ingest.py):
 *   1. Skip paths whose first segment is "inbox" (inbox-watcher handles those).
 *   2. Skip paths where ANY segment starts with "." (dotfile dirs such as
 *      .obsidian/, .summaries/, .stfolder/).
 *   3. Skip paths that don't end with ".md".
 */
function shouldInclude(path: string): boolean {
  if (!path.endsWith(".md")) return false;
  const segments = path.split("/");
  // Rule 1: top-level inbox dir
  if (segments[0] === "inbox") return false;
  // Rule 2: any dotfile segment
  if (segments.some((s) => s.startsWith("."))) return false;
  return true;
}

/** Compute SHA256 hex digest of a UTF-8 string (matches Python's hashlib.sha256). */
function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Read all ingestable vault markdown files via the vault-server HTTP API.
 *
 * 1. GET /tree          → list of all vault paths (flatPaths)
 * 2. Filter: keep only paths that pass shouldInclude()
 * 3. GET /page?path=<p> → content for each included path
 * 4. Compute SHA256 of content string
 *
 * Returns Result<VaultFile[]>. Any HTTP error or network failure returns
 * { ok: false, error: <message> }.
 */
export async function readVault(
  vaultServerUrl: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Result<VaultFile[]>> {
  const base = vaultServerUrl.replace(/\/$/, "");

  // --- Step 1: fetch the tree ---
  const treeResult = await fetchJson<TreeResponse>(
    `${base}/tree`,
    timeoutMs,
  );
  if (!treeResult.ok) return treeResult;

  const allPaths = treeResult.data.flatPaths;
  const includedPaths = allPaths.filter(shouldInclude);

  // --- Step 2: fetch each page ---
  const files: VaultFile[] = [];

  for (const p of includedPaths) {
    const params = new URLSearchParams({ path: p });
    const pageResult = await fetchJson<PageResponse>(
      `${base}/page?${params}`,
      timeoutMs,
    );
    if (!pageResult.ok) return pageResult;

    const { content } = pageResult.data;
    files.push({
      path: p,
      content,
      sha256: sha256(content),
    });
  }

  return { ok: true, data: files };
}

/** Generic JSON fetch with timeout, returning a Result<T>. */
async function fetchJson<T>(
  url: string,
  timeoutMs: number,
): Promise<Result<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });
    const json = (await res.json()) as T & { error?: string };
    if (!res.ok) {
      const detail = (json as { error?: string }).error;
      return {
        ok: false,
        error: detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`,
      };
    }
    return { ok: true, data: json };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "vault-server unreachable",
    };
  } finally {
    clearTimeout(timer);
  }
}
