# ADR-0002: UI Library Selection

## Status

Accepted — 2026-05-17 (retroactively documented; decision is live on `main`)

---

## Context

AgenticOS's dashboard is a Next.js App Router project (React Server Components, TypeScript) maintained by a single developer. The brand specification (`docs/brand.md`) codifies a precise component surface — 21 named primitives in Section 9's Component Primitives Inventory — each with explicit density, color-token, and typography requirements tied to the warm-black/plum/gold palette defined in §§ 5–7.

Three non-negotiable constraints shaped the library decision:

1. **Velocity.** A one-person team cannot afford to build and maintain accessible primitives from scratch. Keyboard navigation, ARIA roles, focus trapping, and screen-reader semantics represent at minimum a year of work at this staffing level.
2. **Full source ownership.** Components must live in `components/ui/` as editable TypeScript files — no black-box vendor at runtime. This is a prerequisite for applying the brand's semantic token system (`--accent-plum-*`, `--surface-*`, `--text-*`) without fighting a library's own theming layer.
3. **Tailwind v4 compatibility.** The brand spec drives all spacing, color, and typography through utility classes. The chosen library must not fight a CSS-first Tailwind setup (no `tailwind.config.ts`, no CSS-in-JS, no runtime emotion/styled-components layer).

---

## Decision

**shadcn/ui (style: `base-nova`) on top of Base UI primitives, with the following supporting picks:**

| Concern | Choice |
|---|---|
| Component framework | shadcn/ui v4, style `base-nova` |
| Primitive layer | `@base-ui/react` ^1.4.1 |
| CSS framework | Tailwind v4 (CSS-first, no config file) |
| Icons | `lucide-react` (canonical per brand spec §9) |
| Command palette | `cmdk` ^1.0.4 |
| Toasts | `sonner` ^2.0.7 |
| Variant utility | `class-variance-authority` + `clsx` + `tailwind-merge` (`cn()`) |

shadcn/ui v4 switched its canonical primitive layer from Radix UI to Base UI — the Radix team's successor project. The `base-nova` style ships with Base UI internals and is the upstream-maintained path going forward. This is reflected in `apps/dashboard/components.json` (`"style": "base-nova"`) and the `@base-ui/react` dependency in `package.json`.

Components are installed as source files into `components/ui/`. Every file is owned and editable. No runtime dependency on shadcn beyond the CLI.

---

## Rejected Alternatives

**Mantine** — Ships its own comprehensive component library with an internal theming system. Mantine's `MantineProvider` and CSS module approach conflict with Tailwind v4's utility-first, no-config-file philosophy. Applying AgenticOS's token system on top of Mantine's own tokens would require overriding two theming layers simultaneously.

**Headless UI (Tailwind Labs)** — Intentionally minimal surface area. It covers dialogs, popovers, and menus but leaves cards, badges, tabs, scrollable areas, and the full toast system to the developer. Adopting it would mean hand-building roughly half of the 21 primitives in Section 9 of the brand spec.

**Chakra UI** — Emotion-based styling is fundamentally incompatible with Tailwind v4. Chakra's own design tokens would require a complete bypass to apply the brand system. The library is also on a slower migration path for the App Router.

**Radix Themes** — Radix Themes is a styled component layer over Radix UI. shadcn upstream has moved to Base UI; committing to Radix Themes would mean swimming against the current of shadcn's own evolution.

**Custom-built primitives** — Accessibility compliance alone (WCAG 2.1 AA keyboard navigation, ARIA live regions, focus trapping in dialogs and popovers) is a multi-month project for a team of one. Base UI ships this work; we inherit it.

---

## Consequences

**Positive**

- All 21 component primitives from brand spec §9 map directly to a shadcn/Base UI equivalent or a thin wrapper around one.
- Tailwind v4 CSS-first setup works natively — no `tailwind.config.ts`, styles live in `app/globals.css`.
- `lucide-react` is already specified by name in the brand spec; shadcn's `iconLibrary: "lucide"` config aligns exactly.
- `sonner` and `cmdk` are shadcn's canonical choices for their respective concerns and require minimal setup.
- Full source ownership means the token system (`--accent-plum-*`, `--surface-*`) is applied directly in component files without fighting a vendor theming layer.

**Negative**

- Base UI is newer than Radix; some APIs differ and the ecosystem of third-party tutorials still assumes Radix. Agents or contributors relying on v3 shadcn documentation may encounter divergence.
- `base-nova` style is shadcn v4-only. Any attempt to copy components from older shadcn recipes (shadcn.com v3 docs, pre-2025 blog posts) will fail silently — the component will render but behavioral and style bugs will appear.

**Neutral**

- `tw-animate-css` is included for animation utilities. It supplements Tailwind v4's built-ins without requiring changes to the CSS pipeline.
- `next-themes` handles dark/light mode toggling; it integrates with CSS variable tokens transparently.

---

## Migration Notes

These are the Base UI vs Radix differences that will surface for any new contributor who reads shadcn v3 documentation or older code examples. **These exact divergences have already caused bugs in filter chip (Task 3) and command palette (Task 8) work.**

**Popover anatomy has changed.** Base UI splits the old `PopoverPrimitive.Content` into two parts:

```tsx
// Base UI (base-nova) — correct
<PopoverPrimitive.Positioner>
  <PopoverPrimitive.Popup>...</PopoverPrimitive.Popup>
</PopoverPrimitive.Positioner>

// Radix (old shadcn v3) — will not work
<PopoverPrimitive.Content>...</PopoverPrimitive.Content>
```

**There is no `Toast` component.** shadcn v4 removed the Radix-based `Toast` in favour of `sonner`. Do not `npx shadcn add toast` — it will install an incompatible component. Use the `sonner` wrapper at `components/ui/sonner.tsx` and call `toast()` from the `sonner` package directly.

**`Dialog` and `Sheet` use Base UI internals.** The `Dialog.Backdrop`, `Dialog.Popup`, and `Dialog.Close` names replace Radix's `DialogOverlay`, `DialogContent`, and `DialogClose`. Check `components/ui/dialog.tsx` and `components/ui/sheet.tsx` for the exact anatomy before adding custom dialogs.

**Style is `base-nova`, not `new-york`.** When running `npx shadcn add <component>`, the CLI reads `components.json` and fetches the `base-nova` variant. If you run the CLI from a directory without `components.json` in scope, it may fall back to `new-york` and install Radix-backed components. Always run from `apps/dashboard/`.

---

## References

- [shadcn/ui v4 documentation](https://ui.shadcn.com)
- [Base UI documentation](https://base-ui.com)
- AgenticOS brand specification — `docs/brand.md`, §9 Component Primitives Inventory
- shadcn config — `apps/dashboard/components.json`
- Dashboard dependencies — `apps/dashboard/package.json`
