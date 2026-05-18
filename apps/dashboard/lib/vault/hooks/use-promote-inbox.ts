"use client";

import { useMutation } from "@tanstack/react-query";

export interface PromoteProposal {
  destination: string;
  title: string;
  tags: string[];
  body: string;
}

export interface PromoteResult {
  proposed: PromoteProposal;
  confidence: number;
  reasoning: string;
}

async function promoteInbox(inboxPath: string): Promise<PromoteResult> {
  const res = await fetch("/api/vault/inbox/promote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inboxPath }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: "Unknown error" }))) as { error?: string };
    throw new Error(err.error ?? `Promote failed: ${res.status}`);
  }
  return res.json() as Promise<PromoteResult>;
}

export function usePromoteInbox() {
  return useMutation<PromoteResult, Error, string>({
    mutationFn: promoteInbox,
  });
}
