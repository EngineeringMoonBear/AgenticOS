import type { Plugin } from "unified";
import type { Root, Blockquote, Paragraph, Text } from "mdast";
import { visit } from "unist-util-visit";

const SUPPORTED_KINDS = new Set(["note", "info", "warning", "danger", "tip"]);
const CALLOUT_RE = /^\[!(\w+)\]\s*(.*)?$/;

/**
 * mdast→hast bridge fields written into `node.data` so rehype renders the
 * blockquote as a custom element. We use a structural anonymous type for the
 * cast rather than a named interface that extends `mdast.Data` — downstream
 * consumers that pull `mdast-util-to-hast` augment `Data` with their own
 * stricter `Properties` type, and an extending interface causes TS2430 in
 * those projects. The shape here is intentionally narrow (only the fields we
 * set) and structurally compatible with both upstream variants.
 */
type CalloutBridgeData = {
  hName?: string;
  hProperties?: { className?: string[] };
};

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
      const data = (node.data ??= {}) as CalloutBridgeData;
      data.hName = "div";
      data.hProperties = { className: ["callout", `callout-${kind}`] };

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
