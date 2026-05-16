"use client";

import { Command } from "lucide-react";

/**
 * Cmd-K command palette trigger. Isolated as a Client Component so the
 * parent Header can stay server-rendered — Server Components cannot pass
 * event handlers (like onClick) across the server/client boundary.
 *
 * Currently visual-only; Task 8 will wire onClick to the palette store.
 */
export function PaletteTrigger() {
  return (
    <button
      type="button"
      className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-[--surface-muted]"
      style={{ color: "var(--text-muted)" }}
      aria-label="Open command palette (⌘K)"
    >
      <Command size={12} strokeWidth={1.5} aria-hidden="true" />
      <kbd
        className="font-mono text-[11px]"
        style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
      >
        K
      </kbd>
    </button>
  );
}
