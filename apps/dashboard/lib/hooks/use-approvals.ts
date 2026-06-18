"use client";
import { useQuery } from "@tanstack/react-query";

export interface ApprovalRow {
  id: string;
  type: string;
  requestedBy: string | null;
  status: string;
}

interface ApprovalsResponse {
  approvals: ApprovalRow[];
}

export function useApprovals() {
  return useQuery<ApprovalsResponse>({
    queryKey: ["approvals"],
    queryFn: async () => {
      const res = await fetch("/api/approvals");
      if (!res.ok) throw new Error(`approvals fetch failed: HTTP ${res.status}`);
      return res.json() as Promise<ApprovalsResponse>;
    },
    refetchInterval: 30_000,
    staleTime: 25_000,
  });
}
