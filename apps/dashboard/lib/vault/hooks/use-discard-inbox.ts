"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

async function discardInbox(inboxPath: string): Promise<void> {
  const res = await fetch("/api/vault/inbox/discard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inboxPath }),
  });
  if (!res.ok && res.status !== 204) {
    const err = (await res.json().catch(() => ({ error: "Unknown error" }))) as { error?: string };
    throw new Error(err.error ?? `Discard failed: ${res.status}`);
  }
}

export function useDiscardInbox() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: discardInbox,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vault", "inbox"] });
    },
  });
}
