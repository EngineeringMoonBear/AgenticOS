"use client";

import { useQuery } from "@tanstack/react-query";
import type { InboxNote } from "@agenticos/vault-core";

async function fetchInboxList(): Promise<InboxNote[]> {
  const res = await fetch("/api/vault/inbox");
  if (!res.ok) {
    throw new Error(`Failed to fetch inbox: ${res.status}`);
  }
  const data = (await res.json()) as { items: InboxNote[] };
  return data.items;
}

export function useInboxList() {
  return useQuery<InboxNote[], Error>({
    queryKey: ["vault", "inbox"],
    queryFn: fetchInboxList,
  });
}
