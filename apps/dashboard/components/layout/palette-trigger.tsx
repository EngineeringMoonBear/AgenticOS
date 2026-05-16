"use client";

import { Command } from "lucide-react";

/**
 * Cmd-K command palette trigger button.
 *
 * Phase 1 status (on chore/ci-fixes): visual-only. The button has no onClick
 * so the component is trivially safe across the server/client boundary, but
 * carrying the `"use client"` directive establishes the boundary now. Task 8
 * (command palette, on feat/phase-1-integration) wires this to the Zustand
 * palette store via `usePaletteStore.open()` — when integration merges to
 * main, the wiring lands inside this already-client component with no
 * boundary changes needed.
 *
 * Why a client island? Server Components cannot pass event handlers across
 * the server/client boundary. The Header itself stays server-rendered; this
 * is the smallest possible client carve-out.
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
