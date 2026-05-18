import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root } from "mdast";
import remarkCallouts from "./callouts.js";

/**
 * Build the unified processor used by vault-core.
 *
 * The processor:
 * 1. Parses markdown with remark-parse (CommonMark)
 * 2. Adds GFM extensions (tables, strikethrough, task lists)
 * 3. Applies the Obsidian callout remark plugin
 *
 * Returns a `Root` mdast node.
 */
function buildProcessor() {
  return unified().use(remarkParse).use(remarkGfm).use(remarkCallouts);
}

/**
 * Parse a markdown string to an mdast `Root`.
 */
export function parseMarkdown(markdown: string): Root {
  const processor = buildProcessor();
  const file = processor.parse(markdown);
  return file as Root;
}

/**
 * Run the full unified pipeline (parse + transform) on a markdown string.
 * Returns the transformed `Root` node.
 */
export async function processMarkdown(markdown: string): Promise<Root> {
  const processor = buildProcessor();
  const file = await processor.run(processor.parse(markdown));
  return file as Root;
}

export { buildProcessor };
