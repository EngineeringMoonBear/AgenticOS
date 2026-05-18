import type { WikiPath } from "../types";

export interface WikilinkRef {
  /** The raw path as written inside [[ ]] */
  raw: string;
  /** Optional display alias (the part after |) */
  alias?: string;
}

/**
 * Extract wikilink references from markdown body text.
 *
 * Matches [[Path]] and [[Path|Alias]] forms.
 * Does NOT match ![[embed]] — the leading `!` marks embeds and is excluded.
 * Results are deduplicated by raw path.
 */
export function extractWikilinks(body: string): WikilinkRef[] {
  // Negative lookbehind for `!` so embed syntax is excluded
  const RE = /(?<!!)\[\[([^\]]+)\]\]/g;
  const seen = new Set<string>();
  const results: WikilinkRef[] = [];

  for (const m of body.matchAll(RE)) {
    const inner = m[1] ?? "";
    const pipeIdx = inner.indexOf("|");
    const raw = pipeIdx >= 0 ? inner.slice(0, pipeIdx).trim() : inner.trim();
    const alias =
      pipeIdx >= 0 ? inner.slice(pipeIdx + 1).trim() : undefined;

    if (!seen.has(raw)) {
      seen.add(raw);
      results.push({ raw, alias });
    }
  }

  return results;
}

/**
 * Resolve a set of wikilink refs against the known page index.
 *
 * Resolution order:
 * 1. Exact path match (e.g. "Farm/Plot A12")
 * 2. Basename match (last segment, .md extension stripped)
 *
 * Returns `{ resolved, unresolved }`.
 */
export function resolveWikilinks(
  refs: WikilinkRef[],
  knownPaths: WikiPath[]
): { resolved: WikiPath[]; unresolved: string[] } {
  // Build basename -> path map (last-write wins for duplicate basenames)
  const byBasename = new Map<string, WikiPath>();
  for (const p of knownPaths) {
    const base = p
      .split("/")
      .pop()!
      .replace(/\.md$/i, "");
    byBasename.set(base.toLowerCase(), p);
  }

  const knownSet = new Set(knownPaths);
  const resolvedSet = new Set<WikiPath>();
  const unresolved: string[] = [];

  for (const { raw } of refs) {
    const rawNoExt = raw.replace(/\.md$/i, "");

    if (knownSet.has(raw) || knownSet.has(rawNoExt)) {
      resolvedSet.add(knownSet.has(raw) ? raw : rawNoExt);
    } else {
      // Basename lookup
      const basename = rawNoExt.split("/").pop()!;
      const hit = byBasename.get(basename.toLowerCase());
      if (hit) {
        resolvedSet.add(hit);
      } else {
        unresolved.push(raw);
      }
    }
  }

  return { resolved: [...resolvedSet], unresolved };
}
