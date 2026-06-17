"use client";
import { useQuery } from "@tanstack/react-query";

export interface IssueRow {
  id: string;
  title: string;
  status: string;
  /** Coalesced from assigneeAgentId ?? assigneeUserId. Null → "unassigned" in UI. */
  assignee: string | null;
  /** From Issue.priority — string enum or null when unset. */
  priority: string | null;
}

interface IssuesResponse {
  issues: IssueRow[];
}

export function useIssues() {
  return useQuery<IssuesResponse>({
    queryKey: ["issues"],
    queryFn: async () => {
      const res = await fetch("/api/issues");
      if (!res.ok) throw new Error(`issues fetch failed: HTTP ${res.status}`);
      return res.json() as Promise<IssuesResponse>;
    },
    refetchInterval: 30_000,
    staleTime: 25_000,
  });
}
