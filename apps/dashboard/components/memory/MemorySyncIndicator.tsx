"use client";

import { RefreshCw } from "lucide-react";
import { useState, useEffect } from "react";
import { useVaultStats } from "@/lib/vault/hooks/use-vault-stats";
import { useVaultRevalidate } from "@/lib/vault/hooks/use-vault-revalidate";

export function MemorySyncIndicator() {
  const { data: stats } = useVaultStats();
  const { mutate: revalidate, isPending } = useVaultRevalidate();
  // Epoch ms initialised lazily (runs once, not on every render)
  const [epochNow, setEpochNow] = useState<number>(Date.now);

  useEffect(() => {
    const id = setInterval(() => {
      setEpochNow(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const ageSec =
    stats && epochNow > 0 ? Math.floor((epochNow - stats.builtAt) / 1000) : null;

  const isStale = ageSec !== null && ageSec >= 30;

  function handleClick() {
    revalidate();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="flex items-center gap-1.5 text-[12px] transition-colors"
      style={{
        color: isStale ? "var(--accent-gold-400)" : "var(--text-muted)",
        background: "none",
        border: "none",
        cursor: isPending ? "wait" : "pointer",
      }}
      title="Click to refresh vault index"
    >
      <RefreshCw
        size={12}
        strokeWidth={1.5}
        aria-hidden="true"
        className={isPending ? "animate-spin" : ""}
      />
      {ageSec !== null ? (
        <span>Synced {ageSec}s ago</span>
      ) : (
        <span>Loading…</span>
      )}
    </button>
  );
}
