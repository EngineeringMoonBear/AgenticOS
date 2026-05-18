"use client";

import { Unlink, FileQuestion, AlertTriangle } from "lucide-react";
import type { LintIssue } from "@agenticos/vault-core";
import { useLintIssues } from "@/lib/vault/hooks/use-lint-issues";

interface LintPanelProps {
  onNavigate: (path: string) => void;
}

function kindIcon(kind: LintIssue["kind"]) {
  switch (kind) {
    case "broken-link":
      return <Unlink size={10} strokeWidth={1.5} style={{ color: "var(--text-muted)", flexShrink: 0, marginTop: 2 }} aria-hidden="true" />;
    case "orphan":
      return <FileQuestion size={10} strokeWidth={1.5} style={{ color: "var(--text-muted)", flexShrink: 0, marginTop: 2 }} aria-hidden="true" />;
    case "todo":
      return <AlertTriangle size={10} strokeWidth={1.5} style={{ color: "var(--text-muted)", flexShrink: 0, marginTop: 2 }} aria-hidden="true" />;
  }
}

export function LintPanel({ onNavigate }: LintPanelProps) {
  const { data: issues = [] } = useLintIssues();

  const brokenCount = issues.filter((i) => i.kind === "broken-link").length;
  const orphanCount = issues.filter((i) => i.kind === "orphan").length;
  const todoCount = issues.filter((i) => i.kind === "todo").length;

  const visible = issues.slice(0, 20);

  return (
    <section className="px-4 py-4">
      <p
        className="text-[11px] font-medium tracking-widest uppercase mb-1"
        style={{ color: "var(--text-muted)" }}
      >
        Lint
      </p>
      <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
        {brokenCount} broken · {orphanCount} orphan · {todoCount} todo
      </p>
      {visible.length > 0 && (
        <ul
          className="space-y-0.5 overflow-y-auto"
          style={{ maxHeight: "12rem" }}
        >
          {visible.map((issue, idx) => {
            const label =
              issue.line != null
                ? `${issue.path}:${issue.line}`
                : issue.path;
            const [pagePart, linePart] =
              issue.line != null
                ? [issue.path, `:${issue.line}`]
                : [issue.path, ""];

            return (
              <li key={`${issue.kind}-${issue.path}-${issue.line ?? idx}`}>
                <button
                  type="button"
                  title={issue.detail}
                  onClick={() => onNavigate(issue.path)}
                  className="flex items-start gap-1.5 w-full text-left rounded-md px-1.5 py-1 transition-colors"
                  style={{ background: "transparent" }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                      "var(--surface-elevated)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                      "transparent";
                  }}
                  aria-label={label}
                >
                  {kindIcon(issue.kind)}
                  <span className="text-[12px] truncate" style={{ color: "var(--text)" }}>
                    {pagePart}
                    {linePart && (
                      <span style={{ color: "var(--text-muted)" }}>{linePart}</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
