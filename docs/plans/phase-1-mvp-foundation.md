# Phase 1 MVP Foundation Implementation Plan

> **⚠️ SUPERSEDED — historical.** This is the early all-mock scaffold (three
> stubbed views wired to `/api/mock/*`, no real integrations). It predates the
> composed stack and the vault-driven Memory tab. For current architecture see
> the [docs index](../README.md) and the authoritative specs:
> [memory/vault-server corrective](../superpowers/specs/2026-05-29-memory-vault-server-corrective-design.md),
> [inbox write surface](../superpowers/specs/2026-06-01-inbox-write-surface-design.md),
> with runtime in [`spec1-orchestrator.md`](./spec1-orchestrator.md). Preserved
> for history.

---

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a fully navigable AgenticOS dashboard with three stubbed views (`/architecture`, `/memory`, `/observability`), a working global filter chip persisted in URL state, a command palette (⌘K), and a settings page — all wired to mock data, no real integrations.

**Architecture:** Turborepo monorepo with a single `apps/dashboard` Next.js 15 App Router app and a `packages/config` package for shared ESLint/TypeScript config. Every data surface is backed by `/api/mock/*` routes returning hardcoded JSON. Global filter state lives exclusively in the URL (`?filter=goldberry,code`) synced via `nuqs`, consumed by a thin Zustand store for ephemeral overlay state.

**Tech Stack:** Next.js 15 (App Router), TypeScript strict, Turborepo, pnpm workspaces, shadcn/ui (Radix primitives + Tailwind CSS), TanStack Query v5, nuqs v2, Zustand v5, Vitest, Playwright.

---

## Dependency DAG

```
Task 1: Bootstrap monorepo
    └─→ Task 2: Base layout & header shell
            ├─→ Task 3: Global filter chip + URL state
            │       ├─→ Task 4: /architecture skeleton
            │       ├─→ Task 5: /memory skeleton
            │       └─→ Task 6: /observability skeleton
            └─→ Task 7: Settings page
Task 8: Command palette    ← depends on Tasks 2, 4, 5, 6 (needs routes + stubs)
```

**Sequential constraint:** Task 1 must complete before anything else. Task 2 must complete before Tasks 3, 7, 8. Task 3 must complete before Tasks 4, 5, 6. Task 8 can be started after Task 6 completes (needs all stubs populated).

**Estimated half-days:** Task 1 = 1, Task 2 = 1, Task 3 = 1, Task 4 = 0.5, Task 5 = 0.5, Task 6 = 0.5, Task 7 = 1, Task 8 = 1. **Total: 6.5 half-days (~3.5 working days).**

---

## Monorepo Layout

```
AgenticOS/
├── apps/
│   └── dashboard/                    # Next.js 15 app
│       ├── app/
│       │   ├── layout.tsx            # Root layout: QueryProvider + NuqsAdapter + font
│       │   ├── page.tsx              # Redirect to /architecture
│       │   ├── architecture/
│       │   │   └── page.tsx
│       │   ├── memory/
│       │   │   └── page.tsx
│       │   ├── observability/
│       │   │   └── page.tsx
│       │   └── settings/
│       │       └── page.tsx
│       ├── api/
│       │   ├── taxonomy/
│       │   │   └── route.ts          # GET → tag list
│       │   ├── mock/
│       │   │   ├── skills/
│       │   │   │   └── route.ts      # GET → skill list
│       │   │   ├── wiki/
│       │   │   │   └── route.ts      # GET → wiki tree + pages
│       │   │   └── runs/
│       │   │       └── route.ts      # GET → run list
│       │   ├── settings/
│       │   │   └── route.ts          # GET + PUT → ~/.agenticos/config.json
│       │   └── events/
│       │       └── route.ts          # SSE stub (emits keep-alives only in Phase 1)
│       ├── components/
│       │   ├── shell/
│       │   │   ├── AppHeader.tsx
│       │   │   ├── ViewTabs.tsx
│       │   │   ├── FilterChip.tsx
│       │   │   └── SettingsGear.tsx
│       │   ├── architecture/
│       │   │   ├── SkillCard.tsx
│       │   │   └── SkillGrid.tsx
│       │   ├── memory/
│       │   │   ├── WikiSidebar.tsx
│       │   │   ├── PageReader.tsx
│       │   │   └── BacklinksRail.tsx
│       │   ├── observability/
│       │   │   ├── LiveRunsStrip.tsx
│       │   │   ├── RunFeed.tsx
│       │   │   └── MetricsSidebar.tsx
│       │   ├── settings/
│       │   │   ├── SettingsModal.tsx
│       │   │   └── SettingsSections.tsx
│       │   └── command-palette/
│       │       └── CommandPalette.tsx
│       ├── hooks/
│       │   ├── useFilterState.ts     # nuqs parser + URL sync
│       │   └── useSettings.ts        # TanStack Query over /api/settings
│       ├── lib/
│       │   ├── filter-parser.ts      # Pure URL ↔ tag-array codec
│       │   └── config-io.ts          # Server-only: reads/writes ~/.agenticos/config.json
│       ├── store/
│       │   └── ui-store.ts           # Zustand: commandPaletteOpen, settingsOpen, activeDrawer
│       ├── types/
│       │   └── index.ts              # Skill, WikiPage, Run, Tag, AppConfig interfaces
│       ├── components.json           # shadcn/ui config
│       ├── tailwind.config.ts
│       ├── next.config.ts
│       └── tsconfig.json
├── packages/
│   └── config/
│       ├── eslint-config/
│       │   └── index.js
│       └── tsconfig/
│           ├── base.json
│           └── nextjs.json
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

## Contracts & Shapes

### `~/.agenticos/config.json`

```jsonc
{
  // File is created on first settings save. Missing keys get defaults at read time.
  "vaultPath": "~/Documents/Dev Projects/vault",
  "projectRoots": [
    {
      "path": "~/Documents/Dev Projects/gather-at-the-grove",
      "tags": ["goldberry", "code"],
      "defaultLane": "sandcastle"
    }
  ],
  "modelDefaults": {
    // Maps task-type slug → model tier string
    "mechanical-bash": "fast",
    "structured-extraction": "fast",
    "summarization": "fast",
    "content-drafting": "balanced",
    "code-generation": "balanced",
    "planning": "balanced",
    "design-judgment": "reasoning",
    "vision": "balanced",
    "multi-step-autonomous": "balanced"
  },
  "appearance": {
    "theme": "dark",
    "accentColor": "plum",
    "fontSize": "normal"
  },
  "hermes": {
    "mode": "local",
    "pidFile": "~/.hermes/hermes.pid",
    "apiPort": 8765,
    "restartOnCrash": true
  },
  "sandcastle": {
    "defaultDockerfile": "~/Documents/Dev Projects/.sandcastle/Dockerfile.default",
    "defaultBranchStrategy": "branch",
    "worktreeBaseDir": "~/Documents/Dev Projects/.worktrees/"
  },
  "connectors": []
}
```

Server reads with `fs.readFile` + `JSON.parse`; writes with `JSON.stringify(config, null, 2)` + `fs.writeFile`. Path is always resolved via `os.homedir()` — never trust the raw `~` string in Node.

### Global Filter URL Contract

- Parameter name: `filter`
- Format: comma-separated, lowercase, URL-safe tag slugs. No spaces.
- "All" state: param absent entirely (`?filter=` is NOT used — remove the param).
- Multi-value example: `?filter=goldberry,code`
- Max tags: no enforced limit in Phase 1.

```
URL: /architecture?filter=goldberry,code
     ↕
filter-parser.ts encodes/decodes:
  parse("goldberry,code")  → ["goldberry", "code"]
  serialize(["goldberry"])  → "goldberry"
  serialize([])             → undefined  (nuqs removes the param)
```

### `/api/taxonomy` Stub Response

```json
{
  "tags": [
    { "slug": "goldberry",  "label": "Goldberry",  "color": "emerald" },
    { "slug": "instnt",     "label": "Instnt",     "color": "blue"    },
    { "slug": "personal",   "label": "Personal",   "color": "violet"  },
    { "slug": "code",       "label": "Code",       "color": "amber"   },
    { "slug": "cowork",     "label": "Cowork",     "color": "cyan"    },
    { "slug": "farm",       "label": "Farm",       "color": "lime"    },
    { "slug": "marketing",  "label": "Marketing",  "color": "rose"    },
    { "slug": "video",      "label": "Video",      "color": "orange"  }
  ]
}
```

### `/api/mock/skills` Response Shape

```json
{
  "skills": [
    {
      "id": "farm-morning-brief",
      "icon": "🌱",
      "title": "Farm Morning Brief",
      "description": "Drafts Ghost post from daily Obsidian source + publishes.",
      "tags": ["farm", "marketing"],
      "lane": "hermes",
      "lastRunAt": "2026-05-15T05:00:00Z",
      "lastRunStatus": "completed",
      "successRate": 0.94
    }
  ]
}
```

### `/api/mock/wiki` Response Shape

```json
{
  "tree": [
    {
      "id": "goldberry",
      "label": "Goldberry",
      "type": "folder",
      "children": [
        { "id": "goldberry/farm", "label": "Farm", "type": "folder", "children": [
          { "id": "goldberry/farm/syntropic-agriculture", "label": "Syntropic Agriculture", "type": "file" }
        ]}
      ]
    }
  ],
  "inbox": [
    {
      "id": "fleeting-1",
      "title": "2026-05-15-1423",
      "excerpt": "Need to check soil moisture in bed 3...",
      "capturedAt": "2026-05-15T14:23:00Z",
      "tags": ["farm"]
    }
  ]
}
```

### `/api/mock/runs` Response Shape

```json
{
  "runs": [
    {
      "id": "run-001",
      "skillId": "farm-morning-brief",
      "skillTitle": "Farm Morning Brief",
      "skillIcon": "🌱",
      "lane": "hermes",
      "tags": ["farm", "marketing"],
      "status": "running",
      "startedAt": "2026-05-15T07:03:00Z",
      "durationSeconds": 192,
      "model": "claude-sonnet-4-6",
      "estimatedCost": 0.08,
      "tokenCount": 14000
    }
  ]
}
```

---

## Test Strategy

### Unit Tests (Vitest)

Located at `apps/dashboard/lib/__tests__/`.

Cover:
1. `filter-parser.ts` — `parse` and `serialize` functions
2. `config-io.ts` — read with missing file returns defaults; write round-trips correctly

### Playwright Smoke Tests

Located at `apps/dashboard/e2e/`.

Cover:
1. Load `/architecture` — page title visible, SkillCard grid renders
2. Load `/memory` — three-pane layout visible (sidebar + reader + rail)
3. Load `/observability` — live runs strip + run feed visible
4. Global filter — appending `?filter=farm` causes filter chip to show "#farm" pill
5. Settings — clicking gear opens settings modal overlay
6. Command palette — `⌘K` opens overlay, typing "farm" shows results

---

## Task 1: Bootstrap Next.js 15 + Turborepo + pnpm Workspace

**Files:**
- Create: `/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/pnpm-workspace.yaml`
- Create: `/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/package.json`
- Create: `/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/turbo.json`
- Create: `/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/packages/config/tsconfig/base.json`
- Create: `/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/packages/config/tsconfig/nextjs.json`
- Create: `/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/packages/config/tsconfig/package.json`
- Create: `/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/packages/config/eslint-config/index.js`
- Create: `/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/packages/config/eslint-config/package.json`
- Create: `apps/dashboard/` — bootstrapped by `create-next-app`

- [ ] **Step 1: Scaffold the root workspace**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
```

Create `pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Create root `package.json`:
```json
{
  "name": "agenticos",
  "private": true,
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck"
  },
  "devDependencies": {
    "turbo": "^2.3.3"
  },
  "engines": {
    "node": ">=20",
    "pnpm": ">=9"
  }
}
```

- [ ] **Step 2: Create `turbo.json`**

```json
{
  "$schema": "https://turborepo.org/schema.json",
  "ui": "tui",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    }
  }
}
```

- [ ] **Step 3: Create `packages/config` shared tsconfig**

Create `packages/config/tsconfig/package.json`:
```json
{
  "name": "@agenticos/tsconfig",
  "version": "0.0.1",
  "private": true,
  "files": ["base.json", "nextjs.json"]
}
```

Create `packages/config/tsconfig/base.json`:
```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "Base",
  "compilerOptions": {
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleDetection": "force",
    "isolatedModules": true
  }
}
```

Create `packages/config/tsconfig/nextjs.json`:
```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "Next.js",
  "extends": "./base.json",
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "noEmit": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create `packages/config` shared ESLint config**

Create `packages/config/eslint-config/package.json`:
```json
{
  "name": "@agenticos/eslint-config",
  "version": "0.0.1",
  "private": true,
  "main": "index.js",
  "dependencies": {
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "eslint-config-next": "^15.0.0"
  }
}
```

Create `packages/config/eslint-config/index.js`:
```js
/** @type {import("eslint").Linter.Config} */
module.exports = {
  extends: ["next/core-web-vitals", "next/typescript"],
  rules: {
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/consistent-type-imports": "error"
  }
};
```

- [ ] **Step 5: Bootstrap `apps/dashboard` with create-next-app**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
pnpm create next-app@latest apps/dashboard \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --no-src-dir \
  --import-alias "@/*" \
  --turbopack
```

When prompted, accept all defaults. This creates `apps/dashboard/` with Next.js 15 App Router.

- [ ] **Step 6: Replace generated `tsconfig.json` with workspace-extending version**

Replace `apps/dashboard/tsconfig.json` entirely with:
```json
{
  "extends": "@agenticos/tsconfig/nextjs.json",
  "compilerOptions": {
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Update `apps/dashboard/package.json` to add the workspace dependency:
```json
{
  "name": "@agenticos/dashboard",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "^15.3.2",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@tanstack/react-query": "^5.64.0",
    "nuqs": "^2.3.2",
    "zustand": "^5.0.3",
    "cmdk": "^1.0.4"
  },
  "devDependencies": {
    "@agenticos/tsconfig": "workspace:*",
    "@agenticos/eslint-config": "workspace:*",
    "@types/node": "^22",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "typescript": "^5.7.0",
    "vitest": "^2.1.8",
    "@vitejs/plugin-react": "^4.3.4",
    "@playwright/test": "^1.49.1",
    "tailwindcss": "^3.4.17",
    "postcss": "^8.4.49",
    "autoprefixer": "^10.4.20"
  }
}
```

- [ ] **Step 7: Install all dependencies**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
pnpm install
```

Expected output: No errors. Workspace packages linked. `node_modules/.pnpm` populated.

- [ ] **Step 8: Install shadcn/ui**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/apps/dashboard"
pnpm dlx shadcn@latest init
```

When prompted:
- Style: **New York**
- Base color: **Neutral** (brand CSS variables will override — pick Neutral as a neutral base)
- CSS variables: **Yes**

This creates `apps/dashboard/components.json` and `apps/dashboard/app/globals.css` with CSS variable stubs.

Then add the components needed for Phase 1:
```bash
pnpm dlx shadcn@latest add button badge popover command separator scroll-area tabs sheet toast
```

- [ ] **Step 9: Configure Vitest**

Create `apps/dashboard/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"]
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, ".")
    }
  }
});
```

Create `apps/dashboard/vitest.setup.ts`:
```ts
import "@testing-library/jest-dom";
```

Add `@testing-library/jest-dom` and `@testing-library/react` to devDependencies:
```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/apps/dashboard"
pnpm add -D @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 10: Configure Playwright**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/apps/dashboard"
pnpm dlx playwright install --with-deps chromium
```

Create `apps/dashboard/playwright.config.ts`:
```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI
  }
});
```

- [ ] **Step 11: Verify dev server starts**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
pnpm dev
```

Expected: Next.js dev server starts on `http://localhost:3000`. Default Next.js welcome page visible. No TypeScript or ESLint errors in terminal.

- [ ] **Step 12: Commit**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
git add -A
git commit -m "feat: bootstrap Turborepo + Next.js 15 + shadcn/ui monorepo"
```

---

## Task 2: Base Layout & Header Shell

**Files:**
- Create: `apps/dashboard/types/index.ts`
- Create: `apps/dashboard/store/ui-store.ts`
- Create: `apps/dashboard/app/layout.tsx` (replaces generated)
- Create: `apps/dashboard/app/page.tsx` (redirect)
- Create: `apps/dashboard/components/shell/AppHeader.tsx`
- Create: `apps/dashboard/components/shell/ViewTabs.tsx`
- Create: `apps/dashboard/components/shell/FilterChip.tsx` (stub — wired in Task 3)
- Create: `apps/dashboard/components/shell/SettingsGear.tsx`

- [ ] **Step 1: Define shared types**

Create `apps/dashboard/types/index.ts`:
```ts
// Tag from /api/taxonomy
export interface Tag {
  slug: string;
  label: string;
  color: string;
}

// Skill from /api/mock/skills
export interface Skill {
  id: string;
  icon: string;
  title: string;
  description: string;
  tags: string[];
  lane: "hermes" | "sandcastle";
  lastRunAt: string | null;
  lastRunStatus: "completed" | "failed" | "running" | null;
  successRate: number | null;
}

// WikiTree node
export interface WikiNode {
  id: string;
  label: string;
  type: "folder" | "file";
  children?: WikiNode[];
}

// Inbox item
export interface InboxItem {
  id: string;
  title: string;
  excerpt: string;
  capturedAt: string;
  tags: string[];
}

// Run from /api/mock/runs
export interface Run {
  id: string;
  skillId: string;
  skillTitle: string;
  skillIcon: string;
  lane: "hermes" | "sandcastle";
  tags: string[];
  status: "running" | "completed" | "failed" | "awaiting_approval";
  startedAt: string;
  durationSeconds: number;
  model: string;
  estimatedCost: number;
  tokenCount: number;
}

// App config stored in ~/.agenticos/config.json
export interface AppConfig {
  vaultPath: string;
  projectRoots: ProjectRoot[];
  modelDefaults: Record<string, string>;
  appearance: {
    theme: "dark" | "light";
    accentColor: string;
    fontSize: "normal" | "large";
  };
  hermes: {
    mode: "local" | "remote";
    pidFile: string;
    apiPort: number;
    restartOnCrash: boolean;
  };
  sandcastle: {
    defaultDockerfile: string;
    defaultBranchStrategy: string;
    worktreeBaseDir: string;
  };
  connectors: ConnectorConfig[];
}

export interface ProjectRoot {
  path: string;
  tags: string[];
  defaultLane: "hermes" | "sandcastle";
}

export interface ConnectorConfig {
  id: string;
  name: string;
  baseUrl?: string;
  authStatus: "set" | "missing";
  enabled: boolean;
}
```

- [ ] **Step 2: Create Zustand UI store**

Create `apps/dashboard/store/ui-store.ts`:
```ts
import { create } from "zustand";

interface UIState {
  commandPaletteOpen: boolean;
  settingsOpen: boolean;
  activeDrawerId: string | null;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  openDrawer: (id: string) => void;
  closeDrawer: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  commandPaletteOpen: false,
  settingsOpen: false,
  activeDrawerId: null,
  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openDrawer: (id) => set({ activeDrawerId: id }),
  closeDrawer: () => set({ activeDrawerId: null })
}));
```

- [ ] **Step 3: Create root layout with providers**

Replace `apps/dashboard/app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { AppHeader } from "@/components/shell/AppHeader";
import { CommandPalette } from "@/components/command-palette/CommandPalette";
import { Toaster } from "@/components/ui/toaster";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AgenticOS",
  description: "Local-first agentic operations dashboard"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}>
        <NuqsAdapter>
          <QueryProvider>
            <div className="flex h-screen flex-col overflow-hidden">
              <AppHeader />
              <main className="flex-1 overflow-auto">
                {children}
              </main>
            </div>
            <CommandPalette />
            <Toaster />
          </QueryProvider>
        </NuqsAdapter>
      </body>
    </html>
  );
}
```

Create `apps/dashboard/components/providers/QueryProvider.tsx`:
```tsx
"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false
          }
        }
      })
  );
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 4: Create root page redirect**

Create `apps/dashboard/app/page.tsx`:
```tsx
import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/architecture");
}
```

- [ ] **Step 5: Create `ViewTabs` component**

Create `apps/dashboard/components/shell/ViewTabs.tsx`:
```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/architecture", label: "Architecture" },
  { href: "/memory", label: "Memory" },
  { href: "/observability", label: "Observability" }
] as const;

export function ViewTabs() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1">
      {TABS.map((tab) => {
        const isActive = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
              "hover:text-foreground hover:bg-accent",
              isActive
                ? "text-foreground border-b-2 border-[--accent-plum-500]"
                : "text-muted-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 6: Create `FilterChip` stub**

Create `apps/dashboard/components/shell/FilterChip.tsx`:
```tsx
"use client";
// Full implementation in Task 3. This stub renders a static "[Filter ▾]" button.
import { Button } from "@/components/ui/button";
import { SlidersHorizontal } from "lucide-react";

export function FilterChip() {
  return (
    <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs">
      <SlidersHorizontal className="h-3 w-3" />
      All
    </Button>
  );
}
```

- [ ] **Step 7: Create `SettingsGear` component**

Create `apps/dashboard/components/shell/SettingsGear.tsx`:
```tsx
"use client";
import { useUIStore } from "@/store/ui-store";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";

export function SettingsGear() {
  const openSettings = useUIStore((s) => s.openSettings);

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      onClick={openSettings}
      aria-label="Open settings"
    >
      <Settings className="h-4 w-4" />
    </Button>
  );
}
```

- [ ] **Step 8: Create `AppHeader` component**

Create `apps/dashboard/components/shell/AppHeader.tsx`:
```tsx
"use client";
import Link from "next/link";
import { ViewTabs } from "./ViewTabs";
import { FilterChip } from "./FilterChip";
import { SettingsGear } from "./SettingsGear";
import { useUIStore } from "@/store/ui-store";
import { Button } from "@/components/ui/button";
import { useEffect } from "react";

export function AppHeader() {
  const openCommandPalette = useUIStore((s) => s.openCommandPalette);

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        openCommandPalette();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openCommandPalette]);

  return (
    <header className="flex h-11 items-center justify-between border-b border-border px-4 shrink-0">
      {/* Left: Logo */}
      <Link href="/architecture" className="flex items-center gap-2 text-sm font-semibold">
        <span className="text-base">⬡</span>
        <span>AgenticOS</span>
      </Link>

      {/* Center: View tabs */}
      <ViewTabs />

      {/* Right: Filter + ⌘K + Settings */}
      <div className="flex items-center gap-2">
        <FilterChip />
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs font-mono"
          onClick={openCommandPalette}
          aria-label="Open command palette"
        >
          ⌘K
        </Button>
        <SettingsGear />
      </div>
    </header>
  );
}
```

- [ ] **Step 9: Create `CommandPalette` stub (placeholder renders nothing)**

Create `apps/dashboard/components/command-palette/CommandPalette.tsx`:
```tsx
"use client";
// Full implementation in Task 8. Renders nothing in Phase 1 until Task 8.
export function CommandPalette() {
  return null;
}
```

- [ ] **Step 10: Add `lucide-react` dependency**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/apps/dashboard"
pnpm add lucide-react
```

- [ ] **Step 11: Verify layout renders**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
pnpm dev
```

Open `http://localhost:3000` in a browser. Expected: Header with "⬡ AgenticOS", three view tabs, filter chip, ⌘K button, and settings gear all visible. Clicking tabs navigates (may 404 until Task 4/5/6 — that's fine). No console errors.

- [ ] **Step 12: Commit**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
git add -A
git commit -m "feat: add base layout, AppHeader shell, ViewTabs, SettingsGear"
```

---

## Task 3: Global Filter Chip + URL State

**Files:**
- Create: `apps/dashboard/lib/filter-parser.ts`
- Create: `apps/dashboard/lib/__tests__/filter-parser.test.ts`
- Create: `apps/dashboard/hooks/useFilterState.ts`
- Create: `apps/dashboard/app/api/taxonomy/route.ts`
- Modify: `apps/dashboard/components/shell/FilterChip.tsx` (replace stub with real implementation)

- [ ] **Step 1: Write failing unit tests for filter-parser**

Create `apps/dashboard/lib/__tests__/filter-parser.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseTags, serializeTags } from "../filter-parser";

describe("parseTags", () => {
  it("returns empty array for undefined input", () => {
    expect(parseTags(undefined)).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseTags("")).toEqual([]);
  });

  it("parses single tag", () => {
    expect(parseTags("farm")).toEqual(["farm"]);
  });

  it("parses multiple comma-separated tags", () => {
    expect(parseTags("goldberry,code")).toEqual(["goldberry", "code"]);
  });

  it("trims whitespace around slugs", () => {
    expect(parseTags("farm, code")).toEqual(["farm", "code"]);
  });

  it("lowercases all slugs", () => {
    expect(parseTags("Farm,CODE")).toEqual(["farm", "code"]);
  });

  it("deduplicates slugs", () => {
    expect(parseTags("farm,farm")).toEqual(["farm"]);
  });
});

describe("serializeTags", () => {
  it("returns undefined for empty array (removes param)", () => {
    expect(serializeTags([])).toBeUndefined();
  });

  it("serializes single tag", () => {
    expect(serializeTags(["farm"])).toBe("farm");
  });

  it("serializes multiple tags as comma-separated", () => {
    expect(serializeTags(["goldberry", "code"])).toBe("goldberry,code");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/apps/dashboard"
pnpm test -- --reporter=verbose lib/__tests__/filter-parser.test.ts
```

Expected: All tests FAIL with "Cannot find module '../filter-parser'".

- [ ] **Step 3: Implement `filter-parser.ts`**

Create `apps/dashboard/lib/filter-parser.ts`:
```ts
/**
 * Parses the ?filter= URL param value into an array of tag slugs.
 * "goldberry,code" → ["goldberry", "code"]
 * undefined or "" → []
 */
export function parseTags(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return [...new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  )];
}

/**
 * Serializes an array of tag slugs into the ?filter= URL param value.
 * [] → undefined (param is removed from URL)
 * ["farm"] → "farm"
 * ["goldberry", "code"] → "goldberry,code"
 */
export function serializeTags(tags: string[]): string | undefined {
  if (tags.length === 0) return undefined;
  return tags.join(",");
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/apps/dashboard"
pnpm test -- --reporter=verbose lib/__tests__/filter-parser.test.ts
```

Expected: All 8 tests PASS.

- [ ] **Step 5: Create `/api/taxonomy` route**

Create `apps/dashboard/app/api/taxonomy/route.ts`:
```ts
import { NextResponse } from "next/server";
import type { Tag } from "@/types";

const TAGS: Tag[] = [
  { slug: "goldberry", label: "Goldberry", color: "emerald" },
  { slug: "instnt",    label: "Instnt",    color: "blue"    },
  { slug: "personal",  label: "Personal",  color: "violet"  },
  { slug: "code",      label: "Code",      color: "amber"   },
  { slug: "cowork",    label: "Cowork",    color: "cyan"    },
  { slug: "farm",      label: "Farm",      color: "lime"    },
  { slug: "marketing", label: "Marketing", color: "rose"    },
  { slug: "video",     label: "Video",     color: "orange"  }
];

export function GET() {
  return NextResponse.json({ tags: TAGS });
}
```

- [ ] **Step 6: Create `useFilterState` hook**

Create `apps/dashboard/hooks/useFilterState.ts`:
```ts
"use client";
import { useQueryState } from "nuqs";
import { parseTags, serializeTags } from "@/lib/filter-parser";
import { useCallback } from "react";

/**
 * Reads and writes the global ?filter= URL param.
 * Returns the active tag slugs and mutation helpers.
 * URL is the single source of truth — no localStorage.
 */
export function useFilterState() {
  const [rawFilter, setRawFilter] = useQueryState("filter", {
    defaultValue: "",
    shallow: true,
    history: "push"
  });

  const activeTags = parseTags(rawFilter);

  const setTags = useCallback(
    (tags: string[]) => {
      void setRawFilter(serializeTags(tags) ?? null);
    },
    [setRawFilter]
  );

  const addTag = useCallback(
    (slug: string) => {
      if (!activeTags.includes(slug)) {
        setTags([...activeTags, slug]);
      }
    },
    [activeTags, setTags]
  );

  const removeTag = useCallback(
    (slug: string) => {
      setTags(activeTags.filter((t) => t !== slug));
    },
    [activeTags, setTags]
  );

  const clearTags = useCallback(() => setTags([]), [setTags]);

  return { activeTags, setTags, addTag, removeTag, clearTags };
}
```

- [ ] **Step 7: Implement real `FilterChip` component**

Replace `apps/dashboard/components/shell/FilterChip.tsx`:
```tsx
"use client";
import { useFilterState } from "@/hooks/useFilterState";
import { useQuery } from "@tanstack/react-query";
import type { Tag } from "@/types";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";

async function fetchTags(): Promise<Tag[]> {
  const res = await fetch("/api/taxonomy");
  const data = await res.json();
  return data.tags as Tag[];
}

export function FilterChip() {
  const { activeTags, addTag, removeTag, clearTags } = useFilterState();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const { data: allTags = [] } = useQuery({
    queryKey: ["taxonomy"],
    queryFn: fetchTags
  });

  const filteredTags = allTags.filter(
    (t) =>
      t.label.toLowerCase().includes(search.toLowerCase()) &&
      !activeTags.includes(t.slug)
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs max-w-48">
          <SlidersHorizontal className="h-3 w-3 shrink-0" />
          {activeTags.length === 0 ? (
            <span>All</span>
          ) : (
            <span className="truncate">
              {activeTags.map((s) => `#${s}`).join(", ")}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="end">
        {/* Active tags as removable pills */}
        {activeTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {activeTags.map((slug) => (
              <Badge key={slug} variant="secondary" className="gap-1 text-xs">
                #{slug}
                <button
                  onClick={() => removeTag(slug)}
                  aria-label={`Remove ${slug} filter`}
                  className="ml-0.5 rounded-full hover:text-foreground"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            ))}
            <button
              onClick={clearTags}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              Clear all
            </button>
          </div>
        )}

        {/* Search input */}
        <Input
          placeholder="Search tags..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-7 text-xs mb-2"
        />

        {/* Suggested tags */}
        <div className="flex flex-col gap-0.5 max-h-40 overflow-auto">
          {filteredTags.map((tag) => (
            <button
              key={tag.slug}
              onClick={() => {
                addTag(tag.slug);
                setSearch("");
              }}
              className="flex items-center gap-2 rounded px-2 py-1 text-xs text-left hover:bg-accent"
            >
              <span className="font-mono">#{tag.slug}</span>
              <span className="text-muted-foreground">{tag.label}</span>
            </button>
          ))}
          {filteredTags.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">No tags found</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

Add `Input` shadcn component if not already installed:
```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/apps/dashboard"
pnpm dlx shadcn@latest add input
```

- [ ] **Step 8: Verify filter chip in browser**

Start dev server and open `http://localhost:3000/architecture`:
1. Click the Filter chip — popover opens showing all 8 tags.
2. Click "#farm" — chip now shows "#farm", URL changes to `?filter=farm`.
3. Click "#code" — URL becomes `?filter=farm,code`.
4. Click X on "farm" pill — URL becomes `?filter=code`.
5. Click "Clear all" — URL filter param removed, chip shows "All".
6. Copy the URL with `?filter=farm,code`, open in new tab — chip shows both tags on mount.

- [ ] **Step 9: Commit**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
git add -A
git commit -m "feat: implement global filter chip with URL state via nuqs"
```

---

## Task 4: `/architecture` View Skeleton

**Files:**
- Create: `apps/dashboard/app/architecture/page.tsx`
- Create: `apps/dashboard/app/api/mock/skills/route.ts`
- Create: `apps/dashboard/components/architecture/SkillCard.tsx`
- Create: `apps/dashboard/components/architecture/SkillGrid.tsx`

- [ ] **Step 1: Create mock skills API route**

Create `apps/dashboard/app/api/mock/skills/route.ts`:
```ts
import { NextResponse } from "next/server";
import type { Skill } from "@/types";

const MOCK_SKILLS: Skill[] = [
  {
    id: "farm-morning-brief",
    icon: "🌱",
    title: "Farm Morning Brief",
    description: "Drafts Ghost post from daily Obsidian source + publishes.",
    tags: ["farm", "marketing"],
    lane: "hermes",
    lastRunAt: "2026-05-15T05:00:00Z",
    lastRunStatus: "completed",
    successRate: 0.94
  },
  {
    id: "soil-report-analysis",
    icon: "📊",
    title: "Soil Report Analysis",
    description: "Pulls farmOS sensor data + generates weekly report.",
    tags: ["farm"],
    lane: "hermes",
    lastRunAt: "2026-05-09T07:00:00Z",
    lastRunStatus: "completed",
    successRate: 1.0
  },
  {
    id: "harvest-reel-pipeline",
    icon: "📹",
    title: "Harvest Reel Pipeline",
    description: "Drafts EDL from Obsidian sources → renders video.",
    tags: ["video"],
    lane: "hermes",
    lastRunAt: "2026-05-12T10:00:00Z",
    lastRunStatus: "completed",
    successRate: 0.88
  },
  {
    id: "weekly-csa-newsletter",
    icon: "🌿",
    title: "Weekly CSA Newsletter",
    description: "Curates week from inbox → Ghost post.",
    tags: ["farm", "marketing"],
    lane: "hermes",
    lastRunAt: "2026-05-08T08:00:00Z",
    lastRunStatus: "completed",
    successRate: 0.91
  },
  {
    id: "fix-auth-bug",
    icon: "🐛",
    title: "Fix Auth Bug",
    description: "Sandcastle code task for gather-at-the-grove auth module.",
    tags: ["code", "goldberry"],
    lane: "sandcastle",
    lastRunAt: "2026-05-14T14:00:00Z",
    lastRunStatus: "failed",
    successRate: 0.75
  },
  {
    id: "daily-asana-triage",
    icon: "✅",
    title: "Daily Asana Triage",
    description: "Pulls open Asana tasks and surfaces priority items to inbox.",
    tags: ["personal", "cowork"],
    lane: "hermes",
    lastRunAt: "2026-05-15T08:00:00Z",
    lastRunStatus: "completed",
    successRate: 0.97
  }
];

export function GET() {
  return NextResponse.json({ skills: MOCK_SKILLS });
}
```

- [ ] **Step 2: Create `SkillCard` component**

Create `apps/dashboard/components/architecture/SkillCard.tsx`:
```tsx
"use client";
import type { Skill } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MoreHorizontal, Play } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface SkillCardProps {
  skill: Skill;
}

function formatLastRun(lastRunAt: string | null): string {
  if (!lastRunAt) return "Never run";
  try {
    return formatDistanceToNow(new Date(lastRunAt), { addSuffix: true });
  } catch {
    return "Unknown";
  }
}

function statusIcon(status: Skill["lastRunStatus"]): string {
  if (status === "completed") return "✅";
  if (status === "failed") return "❌";
  if (status === "running") return "🔄";
  return "";
}

export function SkillCard({ skill }: SkillCardProps) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-card text-card-foreground shadow-sm hover:border-accent transition-colors">
      {/* Card body */}
      <div className="flex-1 p-4 cursor-pointer">
        <div className="flex items-start gap-2 mb-1">
          <span className="text-xl">{skill.icon}</span>
          <h3 className="text-sm font-semibold leading-tight">{skill.title}</h3>
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
          {skill.description}
        </p>
        <div className="flex flex-wrap gap-1 mb-3">
          {skill.tags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs px-1.5 py-0">
              #{tag}
            </Badge>
          ))}
        </div>
        {skill.lastRunAt && (
          <p className="text-xs text-muted-foreground">
            {statusIcon(skill.lastRunStatus)} Last run: {formatLastRun(skill.lastRunAt)}
            {skill.successRate !== null && (
              <span className="ml-2">{Math.round(skill.successRate * 100)}%</span>
            )}
          </p>
        )}
      </div>

      {/* Card footer */}
      <div className="flex items-center justify-between border-t border-border px-4 py-2">
        <Button
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            // Phase 3: will dispatch skill. For now: no-op with toast.
            alert("Agent dispatch coming in Phase 3");
          }}
        >
          <Play className="h-3 w-3" />
          Run Now
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
```

Add `date-fns`:
```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/apps/dashboard"
pnpm add date-fns
```

- [ ] **Step 3: Create `SkillGrid` component**

Create `apps/dashboard/components/architecture/SkillGrid.tsx`:
```tsx
"use client";
import type { Skill } from "@/types";
import { SkillCard } from "./SkillCard";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

interface SkillGridProps {
  skills: Skill[];
  isLoading: boolean;
}

export function SkillGrid({ skills, isLoading }: SkillGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 p-6 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-48 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <p className="text-muted-foreground text-sm">No skills match the current filter.</p>
        <Button variant="outline" size="sm" onClick={() => alert("New skill creation coming in Phase 3")}>
          <Plus className="h-4 w-4 mr-1.5" />
          Create a skill
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {skills.map((skill) => (
          <SkillCard key={skill.id} skill={skill} />
        ))}
        {/* "New Skill" always-visible card */}
        <button
          onClick={() => alert("New skill creation coming in Phase 3")}
          className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border h-full min-h-36 text-muted-foreground hover:border-accent hover:text-foreground transition-colors"
        >
          <Plus className="h-6 w-6" />
          <span className="text-sm">New Skill</span>
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `/architecture` page**

Create `apps/dashboard/app/architecture/page.tsx`:
```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { useFilterState } from "@/hooks/useFilterState";
import { SkillGrid } from "@/components/architecture/SkillGrid";
import type { Skill } from "@/types";

async function fetchSkills(): Promise<Skill[]> {
  const res = await fetch("/api/mock/skills");
  const data = await res.json();
  return data.skills as Skill[];
}

export default function ArchitecturePage() {
  const { activeTags } = useFilterState();

  const { data: skills = [], isLoading } = useQuery({
    queryKey: ["skills"],
    queryFn: fetchSkills
  });

  const filtered =
    activeTags.length === 0
      ? skills
      : skills.filter((skill) =>
          skill.tags.some((t) => activeTags.includes(t))
        );

  return <SkillGrid skills={filtered} isLoading={isLoading} />;
}
```

- [ ] **Step 5: Verify in browser**

Open `http://localhost:3000/architecture`. Expected:
- Grid of 6 skill cards renders with icons, titles, descriptions, tags, last run info.
- "New Skill" dashed card appears after the last card.
- Selecting `#farm` filter hides non-farm cards.
- "Run Now" button shows alert "coming in Phase 3".

- [ ] **Step 6: Commit**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
git add -A
git commit -m "feat: add /architecture skeleton with SkillCard grid and mock data"
```

---

## Task 5: `/memory` View Skeleton

**Files:**
- Create: `apps/dashboard/app/memory/page.tsx`
- Create: `apps/dashboard/app/api/mock/wiki/route.ts`
- Create: `apps/dashboard/components/memory/WikiSidebar.tsx`
- Create: `apps/dashboard/components/memory/PageReader.tsx`
- Create: `apps/dashboard/components/memory/BacklinksRail.tsx`

- [ ] **Step 1: Create mock wiki API route**

Create `apps/dashboard/app/api/mock/wiki/route.ts`:
```ts
import { NextResponse } from "next/server";
import type { WikiNode, InboxItem } from "@/types";

const WIKI_TREE: WikiNode[] = [
  {
    id: "goldberry",
    label: "Goldberry",
    type: "folder",
    children: [
      {
        id: "goldberry/farm",
        label: "Farm",
        type: "folder",
        children: [
          { id: "goldberry/farm/syntropic-agriculture", label: "Syntropic Agriculture", type: "file" },
          { id: "goldberry/farm/soil-health", label: "Soil Health Log", type: "file" },
          { id: "goldberry/farm/crop-calendar", label: "Crop Calendar", type: "file" }
        ]
      },
      {
        id: "goldberry/marketing",
        label: "Marketing",
        type: "folder",
        children: [
          { id: "goldberry/marketing/ghost-cms", label: "Ghost CMS", type: "file" },
          { id: "goldberry/marketing/buffer", label: "Buffer", type: "file" }
        ]
      }
    ]
  },
  {
    id: "personal",
    label: "Personal",
    type: "folder",
    children: [
      { id: "personal/weekly-review", label: "Weekly Review", type: "file" }
    ]
  }
];

const INBOX: InboxItem[] = [
  {
    id: "fleeting-1",
    title: "2026-05-15-1423",
    excerpt: "Need to check soil moisture in bed 3...",
    capturedAt: "2026-05-15T14:23:00Z",
    tags: ["farm"]
  },
  {
    id: "fleeting-2",
    title: "2026-05-14-0912",
    excerpt: "Harvest time-lapse idea for reel...",
    capturedAt: "2026-05-14T09:12:00Z",
    tags: ["video", "farm"]
  }
];

export function GET() {
  return NextResponse.json({ tree: WIKI_TREE, inbox: INBOX });
}
```

- [ ] **Step 2: Create `WikiSidebar` component**

Create `apps/dashboard/components/memory/WikiSidebar.tsx`:
```tsx
"use client";
import type { WikiNode, InboxItem } from "@/types";
import { useState } from "react";
import { ChevronRight, ChevronDown, FileText, Folder } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface WikiSidebarProps {
  tree: WikiNode[];
  inbox: InboxItem[];
  onSelectPage: (id: string, label: string) => void;
}

function TreeNode({
  node,
  depth,
  onSelectPage
}: {
  node: WikiNode;
  depth: number;
  onSelectPage: (id: string, label: string) => void;
}) {
  const [open, setOpen] = useState(depth === 0);

  if (node.type === "file") {
    return (
      <button
        onClick={() => onSelectPage(node.id, node.label)}
        className="flex items-center gap-1.5 w-full text-left px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        <FileText className="h-3 w-3 shrink-0" />
        {node.label}
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 w-full text-left px-2 py-0.5 text-xs font-medium hover:bg-accent rounded"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <Folder className="h-3 w-3 shrink-0" />
        {node.label}
      </button>
      {open && node.children?.map((child) => (
        <TreeNode key={child.id} node={child} depth={depth + 1} onSelectPage={onSelectPage} />
      ))}
    </div>
  );
}

export function WikiSidebar({ tree, inbox, onSelectPage }: WikiSidebarProps) {
  return (
    <div className="flex flex-col h-full overflow-hidden border-r border-border w-56 shrink-0">
      <div className="flex-1 overflow-auto p-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">Wiki</p>
        {tree.map((node) => (
          <TreeNode key={node.id} node={node} depth={0} onSelectPage={onSelectPage} />
        ))}
      </div>
      <div className="border-t border-border p-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">
          Inbox ({inbox.length})
        </p>
        {inbox.map((item) => (
          <div key={item.id} className="rounded border border-border p-2 mb-1 text-xs">
            <p className="font-mono text-muted-foreground mb-0.5">{item.title}</p>
            <p className="text-foreground line-clamp-2">{item.excerpt}</p>
            <div className="flex gap-1 mt-1">
              <button className="text-xs text-blue-500 hover:underline" onClick={() => alert("Promote coming in Phase 2")}>Promote</button>
              <span className="text-muted-foreground">·</span>
              <button className="text-xs text-muted-foreground hover:underline" onClick={() => alert("Edit coming in Phase 2")}>Edit</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `PageReader` component**

Create `apps/dashboard/components/memory/PageReader.tsx`:
```tsx
"use client";

interface PageReaderProps {
  pageId: string | null;
  pageLabel: string | null;
}

export function PageReader({ pageId, pageLabel }: PageReaderProps) {
  if (!pageId) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
        Select a wiki page from the sidebar
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <h1 className="text-2xl font-bold mb-4">{pageLabel}</h1>
      <div className="prose prose-sm prose-invert max-w-none">
        <p className="text-muted-foreground italic">
          Page content rendering from vault is a Phase 2 feature. This skeleton confirms three-pane layout and navigation.
        </p>
        <p className="text-muted-foreground text-xs mt-4">Page ID: <code>{pageId}</code></p>
      </div>
      <div className="mt-8">
        <button
          className="text-xs text-blue-500 hover:underline"
          onClick={() => alert(`obsidian://open?vault=vault&file=${encodeURIComponent(pageId)}`)}
        >
          Open in Obsidian ↗
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `BacklinksRail` component**

Create `apps/dashboard/components/memory/BacklinksRail.tsx`:
```tsx
"use client";

interface BacklinksRailProps {
  pageId: string | null;
}

export function BacklinksRail({ pageId }: BacklinksRailProps) {
  if (!pageId) {
    return <div className="w-48 shrink-0 border-l border-border" />;
  }

  // Stubbed — real backlink resolution is Phase 2
  const stubBacklinks = ["Farm Overview", "Crop Calendar", "Soil Health Log"];
  const stubOutgoing = ["Ghost CMS", "Odoo Setup"];

  return (
    <div className="w-48 shrink-0 border-l border-border overflow-auto p-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Backlinks</p>
      <p className="text-xs text-muted-foreground mb-1">← {stubBacklinks.length} pages</p>
      {stubBacklinks.map((b) => (
        <p key={b} className="text-xs text-foreground py-0.5 hover:underline cursor-pointer">· {b}</p>
      ))}

      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-4 mb-2">Outgoing</p>
      <p className="text-xs text-muted-foreground mb-1">→ {stubOutgoing.length} links</p>
      {stubOutgoing.map((o) => (
        <p key={o} className="text-xs text-foreground py-0.5 hover:underline cursor-pointer">· {o}</p>
      ))}

      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-4 mb-2">Tags</p>
      <div className="flex flex-wrap gap-1">
        <span className="text-xs bg-muted rounded px-1">#farm</span>
        <span className="text-xs bg-muted rounded px-1">#goldberry</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create `/memory` page**

Create `apps/dashboard/app/memory/page.tsx`:
```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { WikiSidebar } from "@/components/memory/WikiSidebar";
import { PageReader } from "@/components/memory/PageReader";
import { BacklinksRail } from "@/components/memory/BacklinksRail";
import type { WikiNode, InboxItem } from "@/types";

async function fetchWiki(): Promise<{ tree: WikiNode[]; inbox: InboxItem[] }> {
  const res = await fetch("/api/mock/wiki");
  return res.json();
}

export default function MemoryPage() {
  const [activePage, setActivePage] = useState<{ id: string; label: string } | null>(null);

  const { data } = useQuery({
    queryKey: ["wiki"],
    queryFn: fetchWiki
  });

  const tree = data?.tree ?? [];
  const inbox = data?.inbox ?? [];

  return (
    <div className="flex h-full">
      {/* Search bar row (stub) */}
      <div className="absolute top-11 left-0 right-0 h-9 border-b border-border flex items-center px-4 gap-4 bg-background z-10">
        <input
          placeholder="🔍 Search wiki pages..."
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          readOnly
        />
        <button className="text-xs text-muted-foreground hover:text-foreground">◉ Graph</button>
        <button className="text-xs text-muted-foreground hover:text-foreground">⚠ Lint 0</button>
      </div>

      {/* Three-pane layout (offset for search bar) */}
      <div className="flex flex-1 mt-9">
        <WikiSidebar
          tree={tree}
          inbox={inbox}
          onSelectPage={(id, label) => setActivePage({ id, label })}
        />
        <PageReader pageId={activePage?.id ?? null} pageLabel={activePage?.label ?? null} />
        <BacklinksRail pageId={activePage?.id ?? null} />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Verify in browser**

Open `http://localhost:3000/memory`. Expected:
- Three-pane layout: wiki sidebar (left), page reader (center), backlinks rail (right).
- Sidebar shows collapsible folder tree. Clicking a file name populates the page reader.
- Inbox section shows 2 stubbed items.
- Backlinks rail shows stubbed data when a page is selected.

- [ ] **Step 7: Commit**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
git add -A
git commit -m "feat: add /memory skeleton with three-pane layout and mock wiki data"
```

---

## Task 6: `/observability` View Skeleton

**Files:**
- Create: `apps/dashboard/app/observability/page.tsx`
- Create: `apps/dashboard/app/api/mock/runs/route.ts`
- Create: `apps/dashboard/app/api/events/route.ts`
- Create: `apps/dashboard/components/observability/LiveRunsStrip.tsx`
- Create: `apps/dashboard/components/observability/RunFeed.tsx`
- Create: `apps/dashboard/components/observability/MetricsSidebar.tsx`

- [ ] **Step 1: Create mock runs API route**

Create `apps/dashboard/app/api/mock/runs/route.ts`:
```ts
import { NextResponse } from "next/server";
import type { Run } from "@/types";

const MOCK_RUNS: Run[] = [
  {
    id: "run-001",
    skillId: "farm-morning-brief",
    skillTitle: "Farm Morning Brief",
    skillIcon: "🌱",
    lane: "hermes",
    tags: ["farm", "marketing"],
    status: "running",
    startedAt: new Date(Date.now() - 192_000).toISOString(),
    durationSeconds: 192,
    model: "claude-sonnet-4-6",
    estimatedCost: 0.08,
    tokenCount: 14000
  },
  {
    id: "run-002",
    skillId: "fix-auth-bug",
    skillTitle: "Fix Auth Bug",
    skillIcon: "🐛",
    lane: "sandcastle",
    tags: ["code", "goldberry"],
    status: "running",
    startedAt: new Date(Date.now() - 64_000).toISOString(),
    durationSeconds: 64,
    model: "claude-sonnet-4-6",
    estimatedCost: 0.12,
    tokenCount: 8000
  },
  {
    id: "run-003",
    skillId: "weekly-csa-newsletter",
    skillTitle: "Weekly CSA Newsletter",
    skillIcon: "🌿",
    lane: "hermes",
    tags: ["farm", "marketing"],
    status: "completed",
    startedAt: new Date(Date.now() - 3_600_000).toISOString(),
    durationSeconds: 252,
    model: "claude-haiku-4-5",
    estimatedCost: 0.03,
    tokenCount: 22000
  },
  {
    id: "run-004",
    skillId: "soil-report-analysis",
    skillTitle: "Soil Report Analysis",
    skillIcon: "📊",
    lane: "hermes",
    tags: ["farm"],
    status: "failed",
    startedAt: new Date(Date.now() - 7_200_000).toISOString(),
    durationSeconds: 43,
    model: "claude-haiku-4-5",
    estimatedCost: 0.01,
    tokenCount: 3000
  }
];

export function GET() {
  return NextResponse.json({ runs: MOCK_RUNS });
}
```

- [ ] **Step 2: Create SSE stub route**

Create `apps/dashboard/app/api/events/route.ts`:
```ts
/**
 * SSE stub for Phase 1. Sends keep-alive pings every 30s.
 * Real run events (run.created, run.updated, run.log, etc.) are Phase 3.
 */
export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      controller.enqueue(encoder.encode("event: connected\ndata: {}\n\n"));

      const interval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          clearInterval(interval);
        }
      }, 30_000);

      // Clean up on close
      return () => clearInterval(interval);
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    }
  });
}
```

- [ ] **Step 3: Create `LiveRunsStrip` component**

Create `apps/dashboard/components/observability/LiveRunsStrip.tsx`:
```tsx
"use client";
import type { Run } from "@/types";

interface LiveRunsStripProps {
  runs: Run[];
}

function laneIcon(lane: Run["lane"]): string {
  return lane === "hermes" ? "🔄" : "🏖️";
}

function elapsedLabel(run: Run): string {
  const secs = run.durationSeconds;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m${s}s` : `${s}s`;
}

export function LiveRunsStrip({ runs }: LiveRunsStripProps) {
  const liveRuns = runs.filter((r) => r.status === "running");

  if (liveRuns.length === 0) return null;

  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-1.5 bg-background shrink-0 overflow-x-auto">
      <span className="text-xs font-semibold text-muted-foreground uppercase shrink-0">Live</span>
      {liveRuns.map((run) => (
        <button
          key={run.id}
          className="flex items-center gap-1.5 rounded-full bg-green-500/10 border border-green-500/30 px-3 py-1 text-xs font-medium shrink-0 hover:bg-green-500/20 transition-colors"
        >
          <span>{laneIcon(run.lane)}</span>
          <span>{run.skillTitle}</span>
          <span className="text-muted-foreground">{elapsedLabel(run)}</span>
          <span className="text-muted-foreground">▸</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Create `RunFeed` component**

Create `apps/dashboard/components/observability/RunFeed.tsx`:
```tsx
"use client";
import type { Run } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface RunFeedProps {
  runs: Run[];
}

function statusBadge(status: Run["status"]): { label: string; className: string } {
  switch (status) {
    case "running":
      return { label: "● RUNNING", className: "bg-green-500/10 text-green-400 border-green-500/30" };
    case "completed":
      return { label: "✅ COMPLETED", className: "bg-muted text-muted-foreground" };
    case "failed":
      return { label: "❌ FAILED", className: "bg-red-500/10 text-red-400 border-red-500/30" };
    case "awaiting_approval":
      return { label: "⏳ AWAITING", className: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30" };
  }
}

function laneIcon(lane: Run["lane"]): string {
  return lane === "hermes" ? "🔄" : "🏖️";
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function formatTokens(t: number): string {
  return t >= 1000 ? `${Math.round(t / 1000)}k` : String(t);
}

function elapsedLabel(run: Run): string {
  const secs = run.durationSeconds;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function RunFeed({ runs }: RunFeedProps) {
  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground text-sm">
        No agent runs yet. Dispatch a skill from /architecture.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4 overflow-auto flex-1">
      {runs.map((run) => {
        const { label: statusLabel, className: statusClass } = statusBadge(run.status);
        return (
          <div key={run.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="flex items-center gap-2">
                <span>{laneIcon(run.lane)}</span>
                <span className="text-sm font-semibold">{run.skillTitle}</span>
                {run.tags.map((t) => (
                  <Badge key={t} variant="outline" className="text-xs px-1.5 py-0">#{t}</Badge>
                ))}
              </div>
              <Badge variant="outline" className={`text-xs ${statusClass}`}>{statusLabel}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              {elapsedLabel(run)} · {run.model} · {run.status === "running" ? "~" : ""}{formatCost(run.estimatedCost)} · {formatTokens(run.tokenCount)} tok
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => alert("Run detail drawer coming in Phase 3")}>
                View Details
              </Button>
              {run.status === "running" && (
                <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => alert("Cancel coming in Phase 3")}>
                  Cancel
                </Button>
              )}
              {run.status === "failed" && (
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => alert("Retry coming in Phase 3")}>
                  Retry
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Create `MetricsSidebar` component**

Create `apps/dashboard/components/observability/MetricsSidebar.tsx`:
```tsx
"use client";
import type { Run } from "@/types";

interface MetricsSidebarProps {
  runs: Run[];
}

export function MetricsSidebar({ runs }: MetricsSidebarProps) {
  const todayRuns = runs.length;
  const todayCost = runs.reduce((acc, r) => acc + r.estimatedCost, 0);

  const schedule = [
    { label: "Farm Brief", time: "07:00", status: "✅" },
    { label: "Asana Triage", time: "08:00", status: "✅" },
    { label: "Curator", time: "Sun", status: "◌" },
    { label: "Video Check", time: "Fri", status: "✅" }
  ];

  return (
    <div className="w-56 shrink-0 border-l border-border overflow-auto p-4 flex flex-col gap-4">
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Metrics</p>
        <div className="flex flex-col gap-1 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Today</span>
            <span>${todayCost.toFixed(2)} · {todayRuns} runs</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Week</span>
            <span className="text-muted-foreground">— (stub)</span>
          </div>
        </div>
        <button className="text-xs text-blue-500 hover:underline mt-2" onClick={() => alert("Full metrics coming in Phase 2")}>
          View full metrics →
        </button>
      </div>

      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Schedule</p>
        <div className="flex flex-col gap-1">
          {schedule.map((s) => (
            <div key={s.label} className="flex items-center justify-between text-xs">
              <span className="text-foreground">{s.label}</span>
              <span className="text-muted-foreground">{s.time} {s.status}</span>
            </div>
          ))}
        </div>
        <button className="text-xs text-blue-500 hover:underline mt-2" onClick={() => alert("Manage schedules coming in Phase 2")}>
          Manage schedules →
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create `/observability` page**

Create `apps/dashboard/app/observability/page.tsx`:
```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { useFilterState } from "@/hooks/useFilterState";
import { LiveRunsStrip } from "@/components/observability/LiveRunsStrip";
import { RunFeed } from "@/components/observability/RunFeed";
import { MetricsSidebar } from "@/components/observability/MetricsSidebar";
import type { Run } from "@/types";

async function fetchRuns(): Promise<Run[]> {
  const res = await fetch("/api/mock/runs");
  const data = await res.json();
  return data.runs as Run[];
}

export default function ObservabilityPage() {
  const { activeTags } = useFilterState();

  const { data: runs = [] } = useQuery({
    queryKey: ["runs"],
    queryFn: fetchRuns,
    refetchInterval: 10_000 // re-poll every 10s in Phase 1 (SSE replaces in Phase 3)
  });

  const filtered =
    activeTags.length === 0
      ? runs
      : runs.filter((r) => r.tags.some((t) => activeTags.includes(t)));

  return (
    <div className="flex flex-col h-full">
      <LiveRunsStrip runs={filtered} />
      <div className="flex flex-1 overflow-hidden">
        <RunFeed runs={filtered} />
        <MetricsSidebar runs={filtered} />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Verify in browser**

Open `http://localhost:3000/observability`. Expected:
- Green "Live" strip at top showing the 2 running runs as pills.
- Run feed below shows all 4 runs with status badges.
- Metrics sidebar on right shows today's cost and stubbed schedule.
- Selecting `?filter=farm` hides the code/goldberry runs.

- [ ] **Step 8: Commit**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
git add -A
git commit -m "feat: add /observability skeleton with live strip, run feed, metrics sidebar"
```

---

## Task 7: Settings Page

**Files:**
- Create: `apps/dashboard/lib/config-io.ts`
- Create: `apps/dashboard/lib/__tests__/config-io.test.ts`
- Create: `apps/dashboard/app/api/settings/route.ts`
- Create: `apps/dashboard/hooks/useSettings.ts`
- Create: `apps/dashboard/components/settings/SettingsModal.tsx`
- Create: `apps/dashboard/components/settings/SettingsSections.tsx`
- Modify: `apps/dashboard/components/shell/SettingsGear.tsx` (add Sheet import)

- [ ] **Step 1: Write failing unit tests for config-io**

Create `apps/dashboard/lib/__tests__/config-io.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readConfig, writeConfig, DEFAULT_CONFIG } from "../config-io";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

// Use a temp dir for tests so we never touch the real ~/.agenticos/
let tempDir: string;
let configPath: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agenticos-test-"));
  configPath = path.join(tempDir, "config.json");
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("readConfig", () => {
  it("returns DEFAULT_CONFIG when file does not exist", async () => {
    const result = await readConfig(configPath);
    expect(result).toEqual(DEFAULT_CONFIG);
  });

  it("merges saved config with defaults (partial file)", async () => {
    await fs.writeFile(configPath, JSON.stringify({ vaultPath: "/custom/vault" }));
    const result = await readConfig(configPath);
    expect(result.vaultPath).toBe("/custom/vault");
    expect(result.appearance).toEqual(DEFAULT_CONFIG.appearance);
  });
});

describe("writeConfig", () => {
  it("writes config as formatted JSON", async () => {
    await writeConfig({ ...DEFAULT_CONFIG, vaultPath: "/test/vault" }, configPath);
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.vaultPath).toBe("/test/vault");
  });

  it("creates directory if it does not exist", async () => {
    const nestedPath = path.join(tempDir, "nested", "config.json");
    await writeConfig(DEFAULT_CONFIG, nestedPath);
    const raw = await fs.readFile(nestedPath, "utf-8");
    expect(JSON.parse(raw)).toMatchObject({ vaultPath: DEFAULT_CONFIG.vaultPath });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/apps/dashboard"
pnpm test -- --reporter=verbose lib/__tests__/config-io.test.ts
```

Expected: FAIL with "Cannot find module '../config-io'".

- [ ] **Step 3: Implement `config-io.ts`**

Create `apps/dashboard/lib/config-io.ts`:
```ts
/**
 * Server-only module. Never import from client components.
 * Reads/writes ~/.agenticos/config.json.
 */
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { AppConfig } from "@/types";

export const CONFIG_PATH = path.join(os.homedir(), ".agenticos", "config.json");

export const DEFAULT_CONFIG: AppConfig = {
  vaultPath: path.join(os.homedir(), "Documents", "Dev Projects", "vault"),
  projectRoots: [],
  modelDefaults: {
    "mechanical-bash": "fast",
    "structured-extraction": "fast",
    "summarization": "fast",
    "content-drafting": "balanced",
    "code-generation": "balanced",
    "planning": "balanced",
    "design-judgment": "reasoning",
    "vision": "balanced",
    "multi-step-autonomous": "balanced"
  },
  appearance: {
    theme: "dark",
    accentColor: "plum",
    fontSize: "normal"
  },
  hermes: {
    mode: "local",
    pidFile: path.join(os.homedir(), ".hermes", "hermes.pid"),
    apiPort: 8765,
    restartOnCrash: true
  },
  sandcastle: {
    defaultDockerfile: path.join(os.homedir(), "Documents", "Dev Projects", ".sandcastle", "Dockerfile.default"),
    defaultBranchStrategy: "branch",
    worktreeBaseDir: path.join(os.homedir(), "Documents", "Dev Projects", ".worktrees")
  },
  connectors: []
};

/**
 * Reads config, merging with defaults for any missing keys.
 * Accepts an optional override path for testing.
 */
export async function readConfig(filePath = CONFIG_PATH): Promise<AppConfig> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const saved = JSON.parse(raw) as Partial<AppConfig>;
    return { ...DEFAULT_CONFIG, ...saved };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { ...DEFAULT_CONFIG };
    }
    throw err;
  }
}

/**
 * Writes config to disk as formatted JSON.
 * Creates parent directory if it doesn't exist.
 */
export async function writeConfig(config: AppConfig, filePath = CONFIG_PATH): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(config, null, 2), "utf-8");
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/apps/dashboard"
pnpm test -- --reporter=verbose lib/__tests__/config-io.test.ts
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Create `/api/settings` route**

Create `apps/dashboard/app/api/settings/route.ts`:
```ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { readConfig, writeConfig } from "@/lib/config-io";
import type { AppConfig } from "@/types";

export async function GET() {
  try {
    const config = await readConfig();
    return NextResponse.json(config);
  } catch (err) {
    return NextResponse.json({ error: "Failed to read config" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as Partial<AppConfig>;
    const existing = await readConfig();
    const merged: AppConfig = { ...existing, ...body };
    await writeConfig(merged);
    return NextResponse.json(merged);
  } catch (err) {
    return NextResponse.json({ error: "Failed to write config" }, { status: 500 });
  }
}
```

- [ ] **Step 6: Create `useSettings` hook**

Create `apps/dashboard/hooks/useSettings.ts`:
```ts
"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { AppConfig } from "@/types";

async function fetchSettings(): Promise<AppConfig> {
  const res = await fetch("/api/settings");
  if (!res.ok) throw new Error("Failed to fetch settings");
  return res.json();
}

async function updateSettings(patch: Partial<AppConfig>): Promise<AppConfig> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
  if (!res.ok) throw new Error("Failed to update settings");
  return res.json();
}

export function useSettings() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["settings"],
    queryFn: fetchSettings
  });

  const mutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: (data) => {
      queryClient.setQueryData(["settings"], data);
    }
  });

  return {
    config: query.data,
    isLoading: query.isLoading,
    save: mutation.mutateAsync,
    isSaving: mutation.isPending
  };
}
```

- [ ] **Step 7: Create `SettingsSections` component**

Create `apps/dashboard/components/settings/SettingsSections.tsx`:
```tsx
"use client";
import { useSettings } from "@/hooks/useSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";

export function SettingsSections() {
  const { config, isLoading, save, isSaving } = useSettings();
  const [vaultPath, setVaultPath] = useState<string>("");

  // Sync local state when config loads
  if (config && vaultPath === "") {
    setVaultPath(config.vaultPath);
  }

  if (isLoading || !config) {
    return <div className="p-6 text-sm text-muted-foreground">Loading settings...</div>;
  }

  return (
    <div className="p-6 flex flex-col gap-8">
      {/* Vault Path */}
      <section>
        <h3 className="text-sm font-semibold mb-3">Vault Path</h3>
        <div className="flex gap-2">
          <Input
            value={vaultPath}
            onChange={(e) => setVaultPath(e.target.value)}
            placeholder="~/Documents/Dev Projects/vault"
            className="flex-1 font-mono text-xs"
          />
          <Button
            size="sm"
            disabled={isSaving || vaultPath === config.vaultPath}
            onClick={() => save({ vaultPath })}
          >
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Path to your Obsidian vault. Change triggers re-index in Phase 2.
        </p>
      </section>

      {/* Project Roots */}
      <section>
        <h3 className="text-sm font-semibold mb-3">Project Roots</h3>
        {config.projectRoots.length === 0 ? (
          <p className="text-xs text-muted-foreground">No project roots configured.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {config.projectRoots.map((root, i) => (
              <div key={i} className="rounded border border-border p-3 text-xs font-mono">
                {root.path} — {root.tags.map((t) => `#${t}`).join(", ")} — {root.defaultLane}
              </div>
            ))}
          </div>
        )}
        <Button
          size="sm"
          variant="outline"
          className="mt-2 text-xs h-7"
          onClick={() => alert("Add project root UI coming in Phase 2")}
        >
          + Add project root
        </Button>
      </section>

      {/* Model Defaults */}
      <section>
        <h3 className="text-sm font-semibold mb-3">Model Defaults</h3>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(config.modelDefaults).map(([taskType, tier]) => (
            <div key={taskType} className="flex items-center justify-between rounded border border-border px-3 py-2 text-xs">
              <span className="text-muted-foreground font-mono">{taskType}</span>
              <span className="font-medium">{tier}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2">Edit per-task model overrides coming in Phase 2.</p>
      </section>

      {/* Appearance */}
      <section>
        <h3 className="text-sm font-semibold mb-3">Appearance</h3>
        <div className="flex flex-col gap-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Theme</span>
            <span>{config.appearance.theme}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Accent</span>
            <span>{config.appearance.accentColor}</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">Theme + accent customization coming in Phase 2.</p>
      </section>
    </div>
  );
}
```

- [ ] **Step 8: Create `SettingsModal` component**

Create `apps/dashboard/components/settings/SettingsModal.tsx`:
```tsx
"use client";
import { useUIStore } from "@/store/ui-store";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import { SettingsSections } from "./SettingsSections";

export function SettingsModal() {
  const settingsOpen = useUIStore((s) => s.settingsOpen);
  const closeSettings = useUIStore((s) => s.closeSettings);

  return (
    <Sheet open={settingsOpen} onOpenChange={(open) => { if (!open) closeSettings(); }}>
      <SheetContent side="right" className="w-[480px] sm:w-[480px] overflow-auto">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
        </SheetHeader>
        <SettingsSections />
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 9: Add `SettingsModal` to root layout**

Modify `apps/dashboard/app/layout.tsx` — add import and element inside `<QueryProvider>`:

After the existing `<CommandPalette />` line, add:
```tsx
import { SettingsModal } from "@/components/settings/SettingsModal";
// ...
<CommandPalette />
<SettingsModal />
<Toaster />
```

- [ ] **Step 10: Add `sheet` shadcn component if not already present**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/apps/dashboard"
pnpm dlx shadcn@latest add sheet
```

- [ ] **Step 11: Verify settings in browser**

Open `http://localhost:3000/architecture` and click the ⚙ gear. Expected:
- Sheet slides in from right labeled "Settings".
- Vault path field shows default path.
- Changing the vault path and clicking "Save" writes to `~/.agenticos/config.json` (verify with `cat ~/.agenticos/config.json`).
- Project roots section shows empty state. "Add project root" shows alert.
- Model defaults table shows all 9 task types.

- [ ] **Step 12: Commit**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
git add -A
git commit -m "feat: add settings page with vault path + config-io persisting to ~/.agenticos/config.json"
```

---

## Task 8: Command Palette (⌘K)

**Files:**
- Modify: `apps/dashboard/components/command-palette/CommandPalette.tsx` (replace stub)

**Dependencies:** Needs all view routes (Tasks 4, 5, 6) and mock API routes to exist so the palette can reference stubs.

- [ ] **Step 1: Replace `CommandPalette` stub with full implementation**

Replace `apps/dashboard/components/command-palette/CommandPalette.tsx`:
```tsx
"use client";
import { useUIStore } from "@/store/ui-store";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from "@/components/ui/command";
import { useEffect } from "react";
import type { Skill, Run } from "@/types";

async function fetchSkills(): Promise<Skill[]> {
  const res = await fetch("/api/mock/skills");
  const data = await res.json();
  return data.skills as Skill[];
}

async function fetchRuns(): Promise<Run[]> {
  const res = await fetch("/api/mock/runs");
  const data = await res.json();
  return data.runs as Run[];
}

export function CommandPalette() {
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen);
  const closeCommandPalette = useUIStore((s) => s.closeCommandPalette);
  const router = useRouter();

  const { data: skills = [] } = useQuery({
    queryKey: ["skills"],
    queryFn: fetchSkills,
    enabled: commandPaletteOpen
  });

  const { data: runs = [] } = useQuery({
    queryKey: ["runs"],
    queryFn: fetchRuns,
    enabled: commandPaletteOpen
  });

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && commandPaletteOpen) {
        closeCommandPalette();
      }
      // ⌘1, ⌘2, ⌘3 shortcuts
      if (e.metaKey && e.key === "1") { e.preventDefault(); router.push("/architecture"); }
      if (e.metaKey && e.key === "2") { e.preventDefault(); router.push("/memory"); }
      if (e.metaKey && e.key === "3") { e.preventDefault(); router.push("/observability"); }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [commandPaletteOpen, closeCommandPalette, router]);

  return (
    <CommandDialog open={commandPaletteOpen} onOpenChange={(open) => { if (!open) closeCommandPalette(); }}>
      <CommandInput placeholder="Search skills, pages, runs..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {/* Navigate section */}
        <CommandGroup heading="Navigate">
          <CommandItem onSelect={() => { router.push("/architecture"); closeCommandPalette(); }}>
            📐 Architecture
          </CommandItem>
          <CommandItem onSelect={() => { router.push("/memory"); closeCommandPalette(); }}>
            🗂 Memory
          </CommandItem>
          <CommandItem onSelect={() => { router.push("/observability"); closeCommandPalette(); }}>
            📡 Observability
          </CommandItem>
          <CommandItem onSelect={() => { useUIStore.getState().openSettings(); closeCommandPalette(); }}>
            ⚙ Settings
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* Skills section */}
        {skills.length > 0 && (
          <CommandGroup heading="Run Skill">
            {skills.map((skill) => (
              <CommandItem
                key={skill.id}
                value={`${skill.title} ${skill.tags.join(" ")}`}
                onSelect={() => {
                  alert(`Skill dispatch coming in Phase 3: ${skill.title}`);
                  closeCommandPalette();
                }}
              >
                {skill.icon} {skill.title}
                <span className="ml-2 text-xs text-muted-foreground">
                  {skill.tags.map((t) => `#${t}`).join(" ")}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />

        {/* Recent Runs section */}
        {runs.length > 0 && (
          <CommandGroup heading="Recent Runs">
            {runs.slice(0, 5).map((run) => (
              <CommandItem
                key={run.id}
                value={`${run.skillTitle} ${run.tags.join(" ")}`}
                onSelect={() => {
                  alert(`Run detail coming in Phase 3: ${run.id}`);
                  closeCommandPalette();
                }}
              >
                {run.skillIcon} {run.skillTitle}
                <span className="ml-2 text-xs text-muted-foreground">{run.status}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />

        {/* Actions */}
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => { alert("New skill creation coming in Phase 3"); closeCommandPalette(); }}>
            ✨ New Skill
          </CommandItem>
          <CommandItem onSelect={() => { alert("Capture to inbox coming in Phase 2"); closeCommandPalette(); }}>
            📥 Capture to Inbox
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
```

- [ ] **Step 2: Verify command palette in browser**

Open `http://localhost:3000/architecture` and press `⌘K`. Expected:
- Overlay opens with search input.
- "Navigate" group shows Architecture, Memory, Observability, Settings.
- "Run Skill" group shows all 6 mock skills, fuzzy-searchable.
- "Recent Runs" group shows up to 5 runs.
- Clicking "Architecture" navigates to `/architecture` and closes palette.
- Pressing `Escape` closes without navigating.
- `⌘1` navigates to /architecture without opening the palette.

- [ ] **Step 3: Add Playwright e2e tests**

Create `apps/dashboard/e2e/smoke.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

test("loads /architecture with skill cards", async ({ page }) => {
  await page.goto("/architecture");
  await expect(page.locator("text=Farm Morning Brief")).toBeVisible();
  await expect(page.locator("text=New Skill")).toBeVisible();
});

test("loads /memory with three-pane layout", async ({ page }) => {
  await page.goto("/memory");
  await expect(page.locator("text=WIKI")).toBeVisible();
  await expect(page.locator("text=INBOX")).toBeVisible();
  await expect(page.locator("text=Select a wiki page from the sidebar")).toBeVisible();
});

test("loads /observability with run feed", async ({ page }) => {
  await page.goto("/observability");
  await expect(page.locator("text=RUNNING")).toBeVisible();
  await expect(page.locator("text=Farm Morning Brief")).toBeVisible();
});

test("global filter applies from URL param", async ({ page }) => {
  await page.goto("/architecture?filter=farm");
  // Farm-tagged skills visible
  await expect(page.locator("text=Farm Morning Brief")).toBeVisible();
  // Filter chip shows the farm tag
  await expect(page.locator("text=#farm")).toBeVisible();
});

test("settings modal opens from gear icon", async ({ page }) => {
  await page.goto("/architecture");
  await page.click("button[aria-label='Open settings']");
  await expect(page.locator("text=Settings")).toBeVisible();
  await expect(page.locator("text=Vault Path")).toBeVisible();
});

test("command palette opens with cmd+k", async ({ page }) => {
  await page.goto("/architecture");
  await page.keyboard.press("Meta+k");
  await expect(page.locator("text=Navigate")).toBeVisible();
  await expect(page.locator("text=Run Skill")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("text=Navigate")).not.toBeVisible();
});
```

- [ ] **Step 4: Run Playwright smoke tests**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/apps/dashboard"
pnpm test:e2e
```

Expected: All 6 tests PASS. (Start dev server first if it isn't running — Playwright's `webServer` config handles this automatically.)

- [ ] **Step 5: Run all unit tests**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/apps/dashboard"
pnpm test
```

Expected: All Vitest tests PASS (filter-parser: 8 tests, config-io: 4 tests).

- [ ] **Step 6: Run TypeScript typecheck across the monorepo**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 7: Run lint across the monorepo**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
pnpm lint
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 8: Commit**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
git add -A
git commit -m "feat: implement command palette (cmd-K) with skill/run/navigate sections"
```

---

## Manual Verification Checklist

A human should work through this before marking Phase 1 complete. Run `pnpm dev` in the monorepo root first.

### Shell & Navigation

- [ ] Logo "⬡ AgenticOS" visible in top-left; clicking it navigates to `/architecture`
- [ ] Three view tabs visible: Architecture, Memory, Observability; active tab has underline accent
- [ ] `⌘1` → /architecture, `⌘2` → /memory, `⌘3` → /observability
- [ ] Filter chip shows "All" when no filter active
- [ ] Clicking filter chip opens popover with 8 tags: goldberry, instnt, personal, code, cowork, farm, marketing, video
- [ ] Selecting "#farm" updates URL to `?filter=farm` and updates chip label
- [ ] Selecting "#code" in addition updates URL to `?filter=farm,code`
- [ ] Clicking X on "#farm" pill removes it from URL; "#code" remains
- [ ] "Clear all" removes `?filter` param entirely; chip shows "All"
- [ ] Copying `?filter=farm,code` URL and opening in new tab: filter chip shows both tags on mount
- [ ] `⌘K` button and keyboard shortcut both open command palette overlay

### /architecture

- [ ] 6 skill cards render with icons, titles, descriptions, tags, last-run status
- [ ] "New Skill" dashed button appears after last card
- [ ] With `?filter=farm` active: only farm-tagged cards visible (Farm Morning Brief, Soil Report, Weekly CSA)
- [ ] "Run Now" button shows alert "coming in Phase 3"
- [ ] `···` button visible (Phase 3 menu items can be no-ops)
- [ ] Empty state: add `?filter=instnt` (no skills tagged instnt) — shows "No skills match" message

### /memory

- [ ] Three-pane layout: wiki sidebar (left, ~220px), page reader (center, fills remaining), backlinks rail (right, ~192px)
- [ ] Wiki sidebar shows collapsible folders: Goldberry, Personal
- [ ] Expanding Goldberry/Farm shows: Syntropic Agriculture, Soil Health Log, Crop Calendar
- [ ] Clicking "Syntropic Agriculture" populates page reader with page name and stub message
- [ ] Backlinks rail shows stubbed data after a page is selected
- [ ] Inbox section shows 2 fleeting notes
- [ ] "Promote" and "Edit" on inbox items show coming-soon alerts

### /observability

- [ ] Live strip shows 2 running run pills: "🔄 Farm Morning Brief" and "🏖️ Fix Auth Bug"
- [ ] Run feed shows all 4 runs with correct status badges (RUNNING ×2, COMPLETED ×1, FAILED ×1)
- [ ] "View Details" button shows alert on all cards
- [ ] "Cancel" button present on RUNNING cards; "Retry" on FAILED card
- [ ] Metrics sidebar shows today's cost and schedule stubs
- [ ] "View full metrics →" and "Manage schedules →" show alerts
- [ ] With `?filter=code` active: only Fix Auth Bug run visible; live strip only shows that run

### Settings

- [ ] ⚙ gear opens settings sheet from right (480px wide)
- [ ] Vault path field shows default path
- [ ] Changing vault path and saving: `cat ~/.agenticos/config.json` shows updated value
- [ ] Reloading page: vault path field still shows saved value (reading from file, not memory)
- [ ] Model defaults table shows all 9 task types with tier labels

### Command Palette

- [ ] `⌘K` opens overlay; input focused automatically
- [ ] Typing "farm" filters to skills/runs with "farm" in title or tags
- [ ] Clicking "Memory" in Navigate section routes to /memory and closes palette
- [ ] `Escape` closes palette without navigating
- [ ] "New Skill" action shows "coming in Phase 3" alert
- [ ] `⌘.` or Settings item in palette opens settings sheet

### Technical Health

- [ ] `pnpm test` — all 12 Vitest tests pass (green)
- [ ] `pnpm test:e2e` — all 6 Playwright smoke tests pass (green)
- [ ] `pnpm typecheck` — 0 TypeScript errors
- [ ] `pnpm lint` — 0 ESLint errors
- [ ] `pnpm build` — production build succeeds with 0 errors

---

## Highest-Risk Steps

1. **Task 1 — Turborepo + pnpm workspace bootstrap**: Turborepo workspace linking with shared `@agenticos/tsconfig` is fiddly. If `pnpm install` doesn't link workspace packages correctly, subsequent `tsconfig extends` will fail silently. Verify by running `pnpm ls --depth 1` in `apps/dashboard` and confirming `@agenticos/tsconfig` resolves to the workspace package. Fix: ensure `packages/config/tsconfig/package.json` has `"files"` field listing `base.json` and `nextjs.json`.

2. **Task 7 — `config-io.ts` server/client boundary**: Next.js App Router will throw if `fs/promises` or `os` is imported on the client side. `config-io.ts` must never be imported by any `"use client"` component. The API route (`/api/settings`) is the only public surface. If you accidentally import `config-io.ts` from a client component, Next.js will throw `Module not found: Can't resolve 'fs'` at build time. Fix: add `import 'server-only'` at top of `config-io.ts`.

3. **Task 3 — nuqs URL state with App Router**: `nuqs` requires `NuqsAdapter` in the root layout (already in plan) and its `useQueryState` hook must only be used in `"use client"` components. If `useFilterState` is called in a Server Component, it will throw. The filter state also needs to survive view navigation — confirm `history: "push"` in `useQueryState` preserves params when switching between view tabs.
