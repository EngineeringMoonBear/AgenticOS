import type { Plugin } from "unified";
import type { Root, Blockquote, Paragraph, Text, Data } from "mdast";
import { visit } from "unist-util-visit";

const SUPPORTED_KINDS = new Set(["note", "info", "warning", "danger", "tip"]);
const CALLOUT_RE = /^\[!(\w+)\]\s*(.*)?$/;

/** Extended Data interface that includes hast bridge properties */
interface HastData extends Data {
  hName?: string;
  hProperties?: Record<string, unknown>;
}

/**
 * Remark plugin: transform Obsidian-style callout blockquotes.
 *
 * Matches: > [!note]  > [!info]  > [!warning]  > [!danger]  > [!tip]
 * Sets hast properties on the blockquote node so rehype renders:
 *   <div class="callout callout-note">...</div>
 *
 * Ordinary blockquotes (no [!kind] prefix) are left unchanged.
 */
const remarkCallouts: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visit(tree, "blockquote", (node: Blockquote) => {
      const firstChild = node.children[0];
      if (!firstChild || firstChild.type !== "paragraph") return;

      const para = firstChild as Paragraph;
      const firstText = para.children[0];
      if (!firstText || firstText.type !== "text") return;

      const text = firstText as Text;
      const firstLine = text.value.split("\n")[0]!;
      const match = CALLOUT_RE.exec(firstLine);
      if (!match) return;

      const kind = match[1]!.toLowerCase();
      if (!SUPPORTED_KINDS.has(kind)) return;

      // Mutate the blockquote to carry hast metadata for rehype
      const data = (node.data ??= {}) as HastData;
      data.hName = "div";
      data.hProperties = {
        className: ["callout", `callout-${kind}`],
        ...(typeof data.hProperties === "object" && data.hProperties !== null
          ? data.hProperties
          : {}),
      };

      // Strip the [!kind] marker from the first text node
      const afterMarker = text.value.slice(firstLine.length);
      const remainder = match[2] ? `${match[2]}${afterMarker}` : afterMarker;
      if (remainder.trimStart()) {
        text.value = remainder.trimStart();
      } else {
        // Remove the empty text node if nothing remains
        para.children.shift();
        if (para.children.length === 0) {
          node.children.shift();
        }
      }
    });
  };
};

export default remarkCallouts;
