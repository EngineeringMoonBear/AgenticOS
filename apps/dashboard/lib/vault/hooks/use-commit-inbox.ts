"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { WikiPage } from "@agenticos/vault-core";

export interface CommitInboxInput {
  inboxPath: string;
  page: Omit<WikiPage, "bodyAst" | "outgoing" | "unresolvedLinks">;
}

async function commitInbox(input: CommitInboxInput): Promise<{ written: WikiPage }> {
  const res = await fetch("/api/vault/inbox/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: "Unknown error" }))) as { error?: string };
    throw new Error(err.error ?? `Commit failed: ${res.status}`);
  }
  return res.json() as Promise<{ written: WikiPage }>;
}

export function useCommitInbox() {
  const queryClient = useQueryClient();
  return useMutation<{ written: WikiPage }, Error, CommitInboxInput>({
    mutationFn: commitInbox,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vault"] });
    },
  });
}
