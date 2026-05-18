"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

interface RevalidateResponse {
  builtAt: number;
  pageCount: number;
}

async function postRevalidate(): Promise<RevalidateResponse> {
  const res = await fetch("/api/vault/revalidate", { method: "POST" });
  if (!res.ok) {
    throw new Error(`Failed to revalidate vault: ${res.status}`);
  }
  return res.json() as Promise<RevalidateResponse>;
}

export function useVaultRevalidate() {
  const queryClient = useQueryClient();

  return useMutation<RevalidateResponse, Error>({
    mutationFn: postRevalidate,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vault"] });
    },
  });
}
