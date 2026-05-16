"use client";

import { ExternalLink, FileText } from "lucide-react";
import type { WikiPage } from "@/lib/fixtures/wiki";

interface MemoryReaderProps {
  page: WikiPage;
  onNavigate: (path: string) => void;
}

const VAULT_NAME = "AgenticOS";

function buildObsidianUrl(path: string): string {
  // Format: obsidian://open?vault=<vault>&file=<encoded-path>
  // path is relative to wiki/ root; Obsidian expects path relative to vault root
  const filePath = "wiki/" + path;
  return (
    "obsidian://open?vault=" +
    encodeURIComponent(VAULT_NAME) +
    "&file=" +
    encodeURIComponent(filePath)
  );
}

type ReactNode = React.ReactNode;

/** Parse a line that may contain [[wikilinks]] into React nodes */
function parseInlineWikilinks(
  line: string,
  onNavigate: (path: string) => void,
  keyPrefix: string
): ReactNode[] {
  const tokens: ReactNode[] = [];
  const wikilinkRe = /\[\[([^\]]+)\]\]/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;

  while ((m = wikilinkRe.exec(line)) !== null) {
    if (m.index > lastIdx) {
      tokens.push(<span key={keyPrefix + "-t-" + lastIdx}>{line.slice(lastIdx, m.index)}</span>);
    }
    const inner = m[1];
    const displayName = inner.includes("|")
      ? inner.split("|")[1]
      : (inner.split("/").pop() ?? inner);
    const captured = inner;
    tokens.push(
      <button
        key={keyPrefix + "-wl-" + m.index}
        type="button"
        onClick={() => onNavigate(captured)}
        className="underline decoration-dotted transition-colors"
        style={{ color: "var(--accent-plum-400)" }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = "var(--accent-plum-300)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = "var(--accent-plum-400)";
        }}
      >
        {displayName}
      </button>
    );
    lastIdx = m.index + m[0].length;
  }

  if (lastIdx < line.length) {
    tokens.push(<span key={keyPrefix + "-t-end"}>{line.slice(lastIdx)}</span>);
  }

  return tokens;
}

/** Render the markdown body into React elements */
function renderBody(body: string, onNavigate: (path: string) => void): ReactNode {
  const lines = body.split("\n");
  const elements: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip H1 (we render title separately)
    if (line.startsWith("# ")) {
      i++;
      continue;
    }

    // H2
    if (line.startsWith("## ")) {
      elements.push(
        <h2
          key={"h2-" + i}
          className="mt-6 mb-2 font-medium"
          style={{ color: "var(--text)", fontSize: "18px" }}
        >
          {line.slice(3)}
        </h2>
      );
      i++;
      continue;
    }

    // H3
    if (line.startsWith("### ")) {
      elements.push(
        <h3
          key={"h3-" + i}
          className="mt-5 mb-2 font-medium"
          style={{ color: "var(--text)", fontSize: "16px" }}
        >
          {line.slice(4)}
        </h3>
      );
      i++;
      continue;
    }

    // Table block — collect all consecutive pipe lines
    if (line.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      // Parse rows, skip separator row (row with only dashes)
      const rows = tableLines
        .filter((r) => !/^\|[\s\-|]+\|$/.test(r))
        .map((r) =>
          r
            .split("|")
            .filter((_, ci, arr) => ci > 0 && ci < arr.length - 1)
            .map((c) => c.trim())
        );
      const [header, ...bodyRows] = rows;
      elements.push(
        <div key={"tbl-" + i} className="my-4 overflow-x-auto">
          <table
            className="w-full text-[13px] border-collapse"
            style={{ color: "var(--text-secondary)" }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                {header?.map((cell, ci) => (
                  <th
                    key={ci}
                    className="text-left px-3 py-2 font-medium"
                    style={{
                      color: "var(--text-muted)",
                      fontSize: "11px",
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                    }}
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr key={ri} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-1.5">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Bullet list item
    if (line.startsWith("- ")) {
      elements.push(
        <li
          key={"li-" + i}
          className="ml-4 my-0.5 list-disc"
          style={{ color: "var(--text-secondary)", fontSize: "14px", lineHeight: 1.6 }}
        >
          {parseInlineWikilinks(line.slice(2), onNavigate, "li-" + i)}
        </li>
      );
      i++;
      continue;
    }

    // Numbered list item
    if (/^\d+\. /.test(line)) {
      const content = line.replace(/^\d+\. /, "");
      elements.push(
        <li
          key={"oli-" + i}
          className="ml-4 my-0.5 list-decimal"
          style={{ color: "var(--text-secondary)", fontSize: "14px", lineHeight: 1.6 }}
        >
          {parseInlineWikilinks(content, onNavigate, "oli-" + i)}
        </li>
      );
      i++;
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      elements.push(<div key={"br-" + i} className="h-2" />);
      i++;
      continue;
    }

    // Default paragraph
    elements.push(
      <p
        key={"p-" + i}
        style={{ color: "var(--text-secondary)", fontSize: "14px", lineHeight: 1.6 }}
      >
        {parseInlineWikilinks(line, onNavigate, "p-" + i)}
      </p>
    );
    i++;
  }

  return elements;
}

export function MemoryReader({ page, onNavigate }: MemoryReaderProps) {
  const obsidianUrl = buildObsidianUrl(page.path);

  return (
    <article
      className="flex flex-col flex-1 overflow-y-auto"
      style={{ backgroundColor: "var(--bg)" }}
    >
      {/* Page header */}
      <div
        className="flex items-start justify-between gap-4 px-8 pt-8 pb-6 border-b"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div className="flex items-start gap-3">
          <FileText
            size={20}
            strokeWidth={1.5}
            className="mt-0.5 shrink-0"
            style={{ color: "var(--text-muted)" }}
            aria-hidden="true"
          />
          <div>
            <h1
              className="font-medium mb-2"
              style={{ color: "var(--text)", fontSize: "22px", lineHeight: 1.2 }}
            >
              {page.title}
            </h1>
            <div className="flex flex-wrap gap-1.5">
              {page.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-[11px] px-1.5 py-0.5 rounded-sm font-medium"
                  style={{
                    color: "var(--accent-plum-300)",
                    backgroundColor: "var(--accent-plum-950)",
                    border: "1px solid var(--accent-plum-700)",
                  }}
                >
                  #{tag}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Open in Obsidian */}
        <a
          href={obsidianUrl}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium border transition-colors shrink-0"
          style={{
            color: "var(--text-secondary)",
            borderColor: "var(--border-brand)",
            backgroundColor: "var(--surface)",
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget as HTMLAnchorElement;
            el.style.color = "var(--text)";
            el.style.borderColor = "var(--border-strong)";
            el.style.backgroundColor = "var(--surface-elevated)";
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLAnchorElement;
            el.style.color = "var(--text-secondary)";
            el.style.borderColor = "var(--border-brand)";
            el.style.backgroundColor = "var(--surface)";
          }}
          title={obsidianUrl}
        >
          <ExternalLink size={14} strokeWidth={1.5} aria-hidden="true" />
          Open in Obsidian
        </a>
      </div>

      {/* Page body */}
      <div className="px-8 py-6 max-w-3xl">{renderBody(page.body, onNavigate)}</div>

      {/* Path breadcrumb */}
      <div className="px-8 pb-8 mt-auto">
        <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
          wiki/{page.path}
        </p>
      </div>
    </article>
  );
}
