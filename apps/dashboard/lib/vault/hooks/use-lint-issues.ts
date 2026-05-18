"use client";

import { useQuery } from "@tanstack/react-query";
import type { LintIssue } from "@agenticos/vault-core";

type LintKind = LintIssue["kind"];

interface LintResponse {
  issues: LintIssue[];
}

async function fetchLintIssues(kind?: LintKind): Promise<LintIssue[]> {
  const url = kind ? `/api/lint?kind=${encodeURIComponent(kind)}` : "/api/lint";
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch lint issues: ${res.status}`);
  }
  const data = (await res.json()) as LintResponse;
  return data.issues;
}

export function useLintIssues(kind?: LintKind) {
  return useQuery<LintIssue[], Error>({
    queryKey: ["vault", "lint", kind ?? "all"],
    queryFn: () => fetchLintIssues(kind),
  });
}
