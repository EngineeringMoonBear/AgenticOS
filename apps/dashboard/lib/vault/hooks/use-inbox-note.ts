"use client";

import { useQuery } from "@tanstack/react-query";
import type { InboxNote } from "@agenticos/vault-core";

async function fetchInboxNote(inboxPath: string): Promise<InboxNote | null> {
  const res = await fetch(
    `/api/vault/inbox/item?path=${encodeURIComponent(inboxPath)}`
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Failed to fetch inbox note: ${res.status}`);
  }
  return res.json() as Promise<InboxNote>;
}

export function useInboxNote(inboxPath: string | null) {
  return useQuery<InboxNote | null, Error>({
    queryKey: ["vault", "inbox", "item", inboxPath],
    queryFn: () => fetchInboxNote(inboxPath!),
    enabled: !!inboxPath,
  });
}
