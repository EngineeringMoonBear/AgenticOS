"use client";

import { useEffect } from "react";
import { usePaletteStore } from "@/lib/palette/use-palette-store";

/**
 * Mounts a global keydown listener for ⌘K / Ctrl+K to open the command palette,
 * and Esc to close it. Mount once in app/layout.tsx near <Toaster />.
 */
export function PaletteHotkey() {
  const toggle = usePaletteStore((s) => s.toggle);
  const close = usePaletteStore((s) => s.close);
  const isOpen = usePaletteStore((s) => s.isOpen);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        toggle();
      }
      if (e.key === "Escape" && isOpen) {
        close();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggle, close, isOpen]);

  return null;
}
