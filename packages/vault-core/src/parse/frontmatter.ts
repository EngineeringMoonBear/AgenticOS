import { parse as yamlParse } from "yaml";

export interface FrontmatterResult {
  meta: Record<string, unknown>;
  body: string;
}

// Matches `---\n...\n---` including empty frontmatter (`---\n---`)
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)(?:\r?\n)?---(?:\r?\n|$)/;

/**
 * Parse YAML frontmatter from a markdown string.
 *
 * Uses yaml@2 strict mode. Rejects dangerous YAML tags (!!js/function etc.).
 * Returns `{ meta: {}, body: source }` when no frontmatter is present.
 *
 * @throws {Error} when frontmatter is present but malformed or uses dangerous tags
 */
export function parseFrontmatter(source: string): FrontmatterResult {
  const match = FRONTMATTER_RE.exec(source);

  if (!match) {
    return { meta: {}, body: source };
  }

  const yamlText = match[1] ?? "";
  const body = source.slice(match[0].length);

  // Reject dangerous YAML tags before parsing
  if (/!![a-z]+\//.test(yamlText)) {
    throw new Error(
      "Dangerous YAML tag detected in frontmatter (e.g. !!js/function)"
    );
  }

  let parsed: unknown;
  try {
    parsed = yamlParse(yamlText, { strict: true });
  } catch (err) {
    throw new Error(
      `Malformed frontmatter YAML: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const meta =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};

  return { meta, body };
}
