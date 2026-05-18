import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkCallouts from "../../src/parse/callouts.js";
import type { Root, Blockquote } from "mdast";
import { visit } from "unist-util-visit";

function parseWithCallouts(markdown: string): Root {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkCallouts);
  return processor.run(processor.parse(markdown)) as unknown as Root;
}

async function buildTree(markdown: string): Promise<Root> {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkCallouts);
  const tree = processor.parse(markdown);
  return (await processor.run(tree)) as Root;
}

function findBlockquotes(tree: Root): Blockquote[] {
  const nodes: Blockquote[] = [];
  visit(tree, "blockquote", (node: Blockquote) => {
    nodes.push(node);
  });
  return nodes;
}

describe("remarkCallouts", () => {
  it("transforms > [!note] blockquote to callout div", async () => {
    const tree = await buildTree("> [!note]\n> This is a note.");
    const bq = findBlockquotes(tree);
    expect(bq).toHaveLength(1);
    expect(bq[0]!.data?.hName).toBe("div");
    expect(
      (bq[0]!.data?.hProperties as { className?: string[] })?.className
    ).toContain("callout-note");
  });

  it("supports info kind", async () => {
    const tree = await buildTree("> [!info]\n> Information here.");
    const bq = findBlockquotes(tree);
    expect(
      (bq[0]!.data?.hProperties as { className?: string[] })?.className
    ).toContain("callout-info");
  });

  it("supports warning kind", async () => {
    const tree = await buildTree("> [!warning]\n> Be careful.");
    const bq = findBlockquotes(tree);
    expect(
      (bq[0]!.data?.hProperties as { className?: string[] })?.className
    ).toContain("callout-warning");
  });

  it("supports danger kind", async () => {
    const tree = await buildTree("> [!danger]\n> Danger zone.");
    const bq = findBlockquotes(tree);
    expect(
      (bq[0]!.data?.hProperties as { className?: string[] })?.className
    ).toContain("callout-danger");
  });

  it("supports tip kind", async () => {
    const tree = await buildTree("> [!tip]\n> Pro tip.");
    const bq = findBlockquotes(tree);
    expect(
      (bq[0]!.data?.hProperties as { className?: string[] })?.className
    ).toContain("callout-tip");
  });

  it("leaves ordinary blockquotes unchanged", async () => {
    const tree = await buildTree("> Just a regular quote");
    const bq = findBlockquotes(tree);
    expect(bq).toHaveLength(1);
    expect(bq[0]!.data?.hName).toBeUndefined();
  });

  it("does not transform unsupported callout kinds", async () => {
    const tree = await buildTree("> [!custom]\n> Unknown kind.");
    const bq = findBlockquotes(tree);
    expect(bq[0]!.data?.hName).toBeUndefined();
  });
});
