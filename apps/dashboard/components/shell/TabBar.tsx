"use client";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";

interface TabDef {
  href: string;
  label: string;
  /** Hard-coded count badge for Phase 3.5.3 — wired to live data in Task 3.5.4. */
  count: string;
}

const TABS: readonly TabDef[] = [
  { href: "/runs", label: "Runs", count: "3" },
  { href: "/architecture", label: "Architecture", count: "11" },
  { href: "/cost", label: "Cost", count: "$2.41" },
  { href: "/health", label: "Health", count: "2 warn" },
  { href: "/memory", label: "Memory", count: "1,652" },
] as const;

/**
 * Desktop: horizontal tab bar (unchanged).
 * Mobile (<768px): dropdown selector showing the active tab, expands
 * to a popover menu on tap. Better UX than cramming 5 tabs + badges
 * into 375px of horizontal space.
 */
export function TabBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeTab =
    TABS.find(
      (t) => pathname === t.href || pathname.startsWith(t.href + "/"),
    ) ?? TABS[0];

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  return (
    <>
      {/* ── Desktop: horizontal tabs ── */}
      <nav
        className="shell-tabs shell-tabs--desktop"
        role="tablist"
        aria-label="Dashboard"
      >
        {TABS.map((t) => {
          const active =
            pathname === t.href || pathname.startsWith(t.href + "/");
          return (
            <Link
              key={t.href}
              href={t.href}
              role="tab"
              aria-selected={active}
              className="shell-tab"
            >
              {t.label}
              <span className="count">{t.count}</span>
            </Link>
          );
        })}
      </nav>

      {/* ── Mobile: dropdown selector ── */}
      <div className="shell-tabs-mobile" ref={menuRef}>
        <button
          type="button"
          className="shell-tabs-mobile__trigger"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={`Dashboard navigation — ${activeTab.label}`}
        >
          <span className="shell-tabs-mobile__label">
            {activeTab.label}
          </span>
          <span className="shell-tabs-mobile__count">
            {activeTab.count}
          </span>
          <ChevronDown
            size={14}
            className={`shell-tabs-mobile__chevron ${open ? "shell-tabs-mobile__chevron--open" : ""}`}
            aria-hidden="true"
          />
        </button>

        {open && (
          <div className="shell-tabs-mobile__menu" role="listbox">
            {TABS.map((t) => {
              const active =
                pathname === t.href ||
                pathname.startsWith(t.href + "/");
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  role="option"
                  aria-selected={active}
                  className={`shell-tabs-mobile__item ${active ? "shell-tabs-mobile__item--active" : ""}`}
                  onClick={() => setOpen(false)}
                >
                  <span>{t.label}</span>
                  <span className="shell-tabs-mobile__item-count">
                    {t.count}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
