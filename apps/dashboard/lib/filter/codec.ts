/**
 * Pure codec functions for the global filter URL parameter.
 *
 * URL contract: ?filter=goldberry,code
 * - Comma-separated, lowercase, URL-safe slugs.
 * - "All" state: param absent entirely (serialize returns "" to signal removal).
 */

/**
 * Serialize an array of tag slugs to a comma-separated string.
 * Returns "" for empty arrays — nuqs uses this to remove the param.
 */
export function serializeFilter(tags: string[]): string {
  return tags.join(",");
}

/**
 * Parse a raw filter string from the URL into a deduplicated, trimmed,
 * lowercase array of tag slugs.
 */
export function parseFilter(raw: string | null | undefined): string[] {
  if (!raw) return [];

  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of raw.split(",")) {
    const slug = part.trim().toLowerCase();
    if (slug && !seen.has(slug)) {
      seen.add(slug);
      result.push(slug);
    }
  }

  return result;
}
