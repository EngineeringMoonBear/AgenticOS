/**
 * Extract inline #tags from markdown text.
 *
 * Rules:
 * - Tags must start with a letter (not a digit or underscore)
 * - Allowed chars after first: word chars and hyphens
 * - Excluded: URL fragments (#anchor in URLs), tags inside code fences,
 *   tags inside inline code spans
 * - Results are deduplicated
 */

const CODE_FENCE_RE = /^```[\s\S]*?^```/gm;
const INLINE_CODE_RE = /`[^`\n]+`/g;

/**
 * Strip code fences and inline code spans from text before tag extraction.
 * Replaces them with spaces of equal length to preserve character offsets.
 */
function stripCode(text: string): string {
  // Replace code fences first (multi-line blocks)
  let result = text.replace(CODE_FENCE_RE, (match) =>
    " ".repeat(match.length)
  );
  // Replace inline code spans
  result = result.replace(INLINE_CODE_RE, (match) =>
    " ".repeat(match.length)
  );
  return result;
}

/**
 * Extract deduplicated inline tags from markdown body.
 * Does not look at frontmatter `tags` field — that's handled separately.
 */
export function extractTags(body: string): string[] {
  const stripped = stripCode(body);
  const seen = new Set<string>();
  const results: string[] = [];

  // Match #tag patterns: must be preceded by a non-word, non-/, non-# char
  // (or start of string/line), and first char of tag name must be a letter
  const matches = Array.from(stripped.matchAll(/(?<![/\w#])#([a-zA-Z][\w-]*)/g));
  for (const m of matches) {
    const tag = m[1]!;
    if (!seen.has(tag)) {
      seen.add(tag);
      results.push(tag);
    }
  }

  return results;
}

/**
 * Merge and deduplicate tags from two sources (e.g. frontmatter + inline).
 */
export function mergeTags(a: string[], b: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const t of [...a, ...b]) {
    if (!seen.has(t)) {
      seen.add(t);
      result.push(t);
    }
  }
  return result;
}
