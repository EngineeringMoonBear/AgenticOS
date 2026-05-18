"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { remarkCallouts } from "@agenticos/vault-core";

export function RenderPageBody({ body }: { body: string }) {
  return (
    <article className="prose prose-invert max-w-none">
      <ReactMarkdown
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        remarkPlugins={[remarkGfm, remarkCallouts as any]}
        rehypePlugins={[rehypeSanitize]}
      >
        {body}
      </ReactMarkdown>
    </article>
  );
}
