# AgenticOS Information Architecture

---

## 1. Global Shell & Navigation

### Header Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ⬡ AgenticOS  │ Architecture  Memory  Observability │ [🔍 Filter ▾]  [⌘K]  ⚙ │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Logo** — left-anchored, links to `/architecture` (default landing).
- **View tabs** — center-anchored, three tabs only. Active tab underlined with plum accent.
- **Global filter chip** — right of center. Shows active tags as removable pills, "All" when empty.
- **Command palette trigger** — `⌘K` button, also keyboard shortcut.
- **Settings gear** — rightmost, opens `/settings` modal overlay.

No breadcrumbs. No secondary nav. Three views is a flat hierarchy — no nesting.

### Filter Chip Anatomy

The filter chip is a multi-select popover. Clicking opens a dropdown with:

1. **Active tags** (removable pills at top)
2. **Suggested tags** (derived from vault folder structure + skill metadata + auto-tagged run data)
3. **Search input** within the popover to filter the tag list
4. **"+ Create tag"** at bottom — creates a new `wiki/[TagName]/` folder in the vault via API route, which makes the tag canonical immediately.

**Interaction rules:**
- Tags are OR-joined within the same domain context (selecting `#goldberry` and `#code` shows items matching either).
- URL persistence: `?filter=goldberry,code` — comma-delimited, lowercase, URL-encoded.
- Filter state is read from URL on mount, written to URL on change. No local storage. Deep-linkable.
- "All" = no `?filter` param. Navigating between views preserves the `?filter` param.

### Command Palette (⌘K)

Single, global command palette. Sections:

| Section | Contents |
|---|---|
| **Run** | All skills, searchable by name/tag/domain. Dispatches immediately or opens confirm drawer. |
| **Navigate** | Switch to Architecture / Memory / Observability |
| **Wiki** | Search wiki page titles. Opens page reader in /memory. |
| **Runs** | Recent + active run titles. Opens run detail drawer. |
| **Settings** | Jump to specific settings panel. |
| **New Skill** | Opens new-skill creation flow. |
| **Capture to Inbox** | Opens quick-capture modal (text or voice upload). |

Search is unified across all sections simultaneously. Ranked by recency and frequency. No section headers shown if empty results in that section.

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `⌘K` | Open command palette |
| `⌘1` | Go to /architecture |
| `⌘2` | Go to /memory |
| `⌘3` | Go to /observability |
| `⌘/` | Focus global filter chip |
| `⌘F` | Focus in-view search (scoped to current view) |
| `Esc` | Close any open drawer/modal |
| `⌘.` | Open settings |

### Notification Surface

- **Transient** (toast): bottom-right corner, 4s auto-dismiss. Used for: skill dispatched, inbox item promoted, run completed.
- **Persistent**: /observability run feed. A run that fails or requires approval surfaces there, not in toasts. Toasts only fire for completions if /observability is NOT the current view.
- No notification bell icon. The /observability tab badge shows count of pending-approval runs only.

---

## 2. /architecture View

### Page Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [All] Farm  Software  Marketing  Video  Personal  +                         │
│─────────────────────────────────────────────────────────────────────────────│
│                                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ Skill    │  │ Skill    │  │ Skill    │  │ Skill    │  │ Skill    │    │
│  │ Card     │  │ Card     │  │ Card     │  │ Card     │  │ Card     │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
│                                                                             │
│  ┌──────────┐  ┌──────────┐  ...                                           │
│  │          │  │          │                                                 │
│  └──────────┘  └──────────┘                                                │
│                                                                             │
│  [+ New Skill]                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Domain rail**: horizontal pill tabs above the grid. These are auto-generated from `wiki/` top-level folders. Selecting a domain tab is equivalent to filtering by that tag — it updates the URL filter.
- **Skills grid**: responsive masonry/fixed-column grid (4 columns at 1440px, 2 at tablet). Cards are uniform height.
- **"+ New Skill"** button: appears after the last card in the grid, always visible.

### Skill Card Anatomy

```
┌────────────────────────────────┐
│ 🌱  Daily Farm Post            │
│ Drafts Ghost post from daily   │
│ Obsidian source + publishes.   │
│                                │
│ #farm #marketing #hermes       │
│                                │
│ Last run: 2h ago · ✅ 94%      │
│────────────────────────────────│
│ [▶ Run Now]          [···]     │
└────────────────────────────────┘
```

| Field | Source |
|---|---|
| Icon | Skill frontmatter `icon:` (emoji or icon name) |
| Title | Skill frontmatter `title:` |
| Description | Skill frontmatter `description:` (max 2 lines, truncated) |
| Tags | Skill frontmatter `tags:` array |
| Last run | Derived from /observability run history |
| Success rate | Derived: completed / (completed + failed) over last 30 runs |
| Run button | Dispatches skill with default config |
| `···` menu | Edit skill, Duplicate, Pin to top, View run history, Delete |

### Skill Detail Drawer

Opens from clicking the card body (not the Run button). Slides in from right, 480px wide.

Sections:
1. **Header** — icon, title, tags, edit button (opens skill YAML file via deep link or inline editor)
2. **Description** — full text
3. **Execution config** — lane (Hermes/Sandcastle), model tier, target project root(s), cron schedule if set
4. **Prompt / workflow** — rendered skill prompt or step list (read-only view; "Edit in file" button)
5. **Run history** — last 10 runs as compact rows (date, duration, status, cost). Links to full run detail.
6. **Run Now** — primary CTA at bottom of drawer, with optional parameter override fields before confirming.

### New Skill Creation Flow

Three-step modal:
1. **Template pick** — "Blank", "Hermes routine", "Sandcastle code task", or import from existing Claude Code skill registry.
2. **Metadata form** — title, description, domain tag, icon, target project root(s), default lane (auto-suggested based on task type).
3. **Prompt editor** — code-mirror textarea for the prompt/workflow YAML. Save creates `~/.claude/skills/[slug].md` (or in the vault under `wiki/Skills/`). Skill is immediately available.

### Empty States

- **No skills yet**: Full-bleed empty state with icon, "Create your first skill" CTA, and link to documentation.
- **No skills match filter**: Inline empty state in grid area: "No skills tagged #[filter]. [Clear filter] or [Create a skill with this tag]."

### How Global Filter Shapes This View

Filter hides cards whose `tags` array has no intersection with active filter tags. Domain rail pills show count of matching skills per domain. If a domain has 0 matching skills, its pill is dimmed (not removed).

---

## 3. /memory View

### Page Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [🔍 Search wiki...]                              [Graph ◉]  [Lint ⚠ 3]      │
├─────────────────┬─────────────────────────────────┬────────────────────────┤
│ WIKI TREE       │  PAGE READER                    │  BACKLINKS             │
│                 │                                 │  ─────────             │
│ ▼ Goldberry     │  # Page Title                   │  ← 3 pages link here   │
│   ├ Farm        │                                 │  · Daily Farm Log      │
│   ├ Marketing   │  [rendered markdown]            │  · Marketing Goals     │
│   └ Projects    │                                 │  · Video Pipeline      │
│ ▼ Personal      │                                 │                        │
│ ▼ Software      │                                 │  OUTGOING LINKS        │
│ ─────────────   │                                 │  ─────────────         │
│ INBOX (7)       │                                 │  → 5 links             │
│ · fleeting-1    │                                 │  · Ghost CMS           │
│ · fleeting-2    │                                 │  · Odoo Setup          │
│ ...             │                                 │                        │
│                 │                                 │  TAGS                  │
│                 │                                 │  #farm #marketing      │
│                 │  [Open in Obsidian ↗]           │                        │
└─────────────────┴─────────────────────────────────┴────────────────────────┘
```

### Wiki Sidebar Tree

- Mirrors `wiki/` folder structure exactly. Folders = collapsible nodes. Files = leaf items.
- Clicking a file opens it in the page reader.
- Right-click on any item: "Open in Obsidian", "View backlinks", "Add to Obsidian graph".
- File count badges on folder nodes (matches current filter).
- "Inbox" section below the tree shows fleeting note count.

### Wiki Page Reader

- Renders Obsidian-flavored markdown: `[[wikilinks]]`, `![[image embeds]]`, callouts, frontmatter hidden by default (expandable).
- Wikilinks are clickable — navigate within the reader.
- **"Open in Obsidian"** deep-link button (bottom of page): fires `obsidian://open?vault=vault&file=[path]`.
- **Edit mode**: not available in AgenticOS. Memory view is read + triage. All edits go through Obsidian. This is a deliberate constraint — concurrent write safety.
- Frontmatter strip at top (collapsible): shows `tags:`, `created:`, `modified:`, `source:` fields.

### Backlinks & Outgoing Links

Right rail, always visible when a page is open.

- **Backlinks**: pages in the vault that contain `[[This Page Name]]`. Shows page title + excerpt of surrounding sentence.
- **Outgoing links**: all `[[links]]` in the current page, listed with title. Broken links shown in red.
- **Tags**: tags from frontmatter, clickable to update global filter.

### Graph View

Toggled via "Graph ◉" button in header bar. Replaces the page reader area with a force-directed node graph.

- Nodes = wiki pages. Edges = wikilinks.
- Color coding: by domain tag.
- Clicking a node opens it in the page reader (graph collapses back, or opens side-by-side).
- This is a **navigation aid**, not a deep exploration tool. For full graph exploration: "Open Graph in Obsidian" button.
- Filtered by global filter: only shows nodes matching active tags.

### Full-Text Search

- Search bar at top of Memory view (separate from ⌘K palette search, which is global).
- Searches page titles, headings, and body text across the vault.
- Results grouped by: exact title match, heading match, body match.
- Supports Obsidian query syntax subset: `tag:#farm`, `path:Goldberry/`.

### Inbox Queue

Below the wiki tree in the sidebar. Each fleeting note from `inbox/` is a card:

```
┌─────────────────────────────┐
│ 📝 2026-05-15-1423          │
│ "Need to check soil         │
│  moisture in bed 3..."      │
│                             │
│ [Promote] [Edit] [Discard]  │
└─────────────────────────────┘
```

- **Promote**: opens a modal. Agent suggests a target `wiki/` page (new or existing) to merge into. User confirms. AgenticOS writes via API route (never direct vault bind-mount from agents).
- **Edit**: opens a simple textarea to revise the fleeting note before promoting.
- **Discard**: marks as archived (moves to `inbox/archived/`, not deleted).
- Inbox items auto-tagged by capture method (voice, text, import).

### Lint Panel

Toggled via "Lint ⚠ N" button (N = count of issues). Opens as a bottom drawer.

| Issue Type | Detection Method | Action |
|---|---|---|
| Broken links | `[[link]]` with no matching file | "Create page" or "Remove link" |
| Orphan pages | Pages with 0 backlinks and not in `sources/` | "Add to index" or "Archive" |
| Contradictions | Agent-detected conflicting facts (Hermes Curator output) | "View conflict" |
| Research gaps | Curator-flagged unanswered questions | "Capture to inbox" |

Lint runs are triggered by the 7-day Hermes Curator cycle. Manual re-run button available.

### How Global Filter Shapes This View

- Wiki tree dims/hides pages whose frontmatter `tags:` has no intersection with active filter.
- Page reader: no change (if you navigated to a page, show it).
- Inbox: filters which fleeting notes are shown (by their auto-tags).
- Backlinks panel: only shows backlinks from pages matching current filter.
- Graph: only renders nodes matching filter.

### AgenticOS Memory vs. Obsidian — When to Use Which

| Task | Use |
|---|---|
| Quick read / triage inbox | AgenticOS Memory |
| Full graph exploration | Obsidian |
| Edit a wiki page | Obsidian |
| Create a new wiki page | Obsidian |
| View lint health summary | AgenticOS Memory |
| Link vault pages to agent runs | AgenticOS Memory |
| Voice capture to inbox | AgenticOS Memory (mobile) |
| Deep search with complex queries | Obsidian |

---

## 4. /observability View

### Page Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ LIVE  [🔄 Farm Morning Brief - running 2m12s] [🏖️ Fix auth bug - running 45s] │
│─────────────────────────────────────────────────────────────────────────────│
│                          │                                                   │
│  RUN FEED               │  METRICS SIDEBAR                                  │
│  ────────────           │  ─────────────                                    │
│  [run card]             │  Today: $0.42  ·  14 runs                         │
│  [run card]             │  This week: $3.18                                 │
│  [run card]             │  ──────────                                        │
│  [run card]             │  SCHEDULE                                         │
│  ...                    │  · Farm Brief  07:00 ✅                            │
│                         │  · Curator     Sun 00:00 ◌                        │
│                         │  · Daily Asana 08:00 ✅                            │
│                         │  [Manage →]                                        │
└─────────────────────────┴────────────────────────────────────────────────────┘
```

### Live Runs Strip

Horizontal scrollable strip pinned at top. Shows only currently-running agents as compact pills with lane indicator and live elapsed time. Auto-updates via SSE. Clicking a pill scrolls to that run in the feed and opens its detail drawer.

### Run Card Anatomy

```
┌─────────────────────────────────────────────────────────────────┐
│ 🔄 Farm Morning Brief          #farm #hermes    ● RUNNING       │
│    Drafts + publishes daily Ghost post                          │
│                                                                 │
│    2m 34s  ·  claude-sonnet-4-6  ·  $0.08  ·  12k tok         │
│                                                                 │
│    [View Details]                          [Cancel]            │
└─────────────────────────────────────────────────────────────────┘
```

| Field | Notes |
|---|---|
| Lane indicator | 🔄 Hermes, 🏖️ Sandcastle |
| Project tag | Auto-tagged from project root at dispatch |
| Status | `● RUNNING` (green), `✅ COMPLETED`, `❌ FAILED`, `⏳ AWAITING APPROVAL` |
| Duration | Live counter for running; final elapsed for completed |
| Model badge | Model ID, abbreviated |
| Cost | Running estimate; final on completion |
| Tokens | Input + output combined |
| Primary action | "View Details" always; secondary: "Cancel" (running), "Retry" (failed), "Approve / Reject" (awaiting) |

### Run Detail Drawer

480px right drawer. Tabs: **Logs**, **Timeline**, **Usage**, **Sandbox**.

**Logs tab**: Live streaming log output (SSE). Syntax-highlighted. Auto-scroll toggle. "Copy all" button.

**Timeline tab**: Horizontal tool-call timeline. Each tool call shown as a labeled segment with duration. Clicking a segment shows the raw input/output JSON.

**Usage tab**:

| Metric | Value |
|---|---|
| Model | claude-sonnet-4-6 |
| Input tokens | 8,421 |
| Output tokens | 3,892 |
| Cache read | 6,200 |
| Cache write | 2,000 |
| Cost | $0.14 |

**Sandbox tab (Sandcastle runs)**:
- Git branch name
- Worktree path
- Dockerfile used
- Branch strategy (`head` / `merge-to-head` / `branch`)
- "Open in terminal" button (fires iTerm deep link)

**Sandbox tab (Hermes runs)**:
- Terminal backend (Docker / Daytona / Modal)
- Container ID
- "Attach to session" button

Footer actions: **Retry**, **Fork with edits** (opens dispatch flow with pre-filled params), **Archive**.

### Schedules Subview

Accessible via "Manage →" link in sidebar, or via direct URL `/observability/schedules`.

Table view:

| Skill | Cron Expression | Next Run | Last Run | Status | Actions |
|---|---|---|---|---|---|
| Farm Morning Brief | `0 7 * * *` | Tomorrow 07:00 | Today 07:00 ✅ | Enabled | Disable / Edit |
| Hermes Curator | `0 0 * * 0` | Sun 00:00 | 8 days ago ✅ | Enabled | Disable / Edit |
| Daily Asana Triage | `0 8 * * 1-5` | Tomorrow 08:00 | Today 08:00 ✅ | Enabled | Disable / Edit |

"+ Add Schedule" button opens a drawer: pick skill → set cron expression (with human-readable preview) → save.

### Metrics & Costs Subview

URL: `/observability/metrics`. Sidebar "View full metrics →" link.

Filters: date range picker, group-by selector (day/week/month), breakdown by (lane / model / tag / skill).

Charts:
1. Spend over time (bar chart, grouped by selected breakdown)
2. Run count over time (line chart)
3. Model usage distribution (donut chart)
4. Top skills by cost (horizontal bar)

All charts respect global filter chip.

### Empty States

- **No runs yet**: "No agent runs yet. Dispatch a skill from /architecture or the command palette."
- **No runs match filter**: "No runs tagged #[filter]. [Clear filter]"
- **Live strip empty**: Strip collapses to 0 height. No placeholder.

### How Global Filter Shapes This View

- Run feed: only shows runs whose auto-tags intersect with active filter.
- Live strip: same.
- Metrics: aggregations computed only over filtered runs.
- Schedules: only shows schedules for skills matching filter.

---

## 5. Cross-View Patterns

### Filter Persistence

```
URL ?filter=goldberry,code
    ↓
useFilterStore (Zustand)
    ↓
All three view components read from store
    ↓
URL updated on every store change (shallow router.replace)
```

No localStorage. URL is the single source of truth. Back button restores previous filter state correctly.

### Search Semantics

⌘K command palette searches across all content types simultaneously. Results are ranked:

1. Exact title match (skill or wiki page)
2. Active runs matching query
3. Body text matches (wiki)
4. Tag matches

In-view search (⌘F) is scoped: in /architecture it searches skill titles/descriptions; in /memory it searches vault text; in /observability it searches run titles and log content.

### "New Run" / Dispatch Flow from Anywhere

1. `⌘K` → type skill name → select from results
2. Dispatch confirm drawer opens (works from any view):
   - Skill name + description
   - Lane (auto-selected, with override toggle)
   - Target project root (pre-filled from skill config, editable)
   - Model override (optional; shows default from routing table)
   - Any skill-declared parameters as form fields
3. "Dispatch" button → run created → toast notification → if on /observability, feed updates live; otherwise badge increments on tab.

### Notification Consistency

- Toast fires for: dispatch confirmed, run completed (when not on /observability), inbox item promoted, vault lint scan complete.
- No toast for: run failed (shows in feed with ❌ status), approval required (tab badge increments).
- Toasts are non-interactive except for a "View" link that navigates to the relevant run or page.

### Real-Time Updates

**Choice: SSE (Server-Sent Events)**

Rationale: AgenticOS is localhost-only, single-user. SSE is simpler than WebSocket (unidirectional, works over HTTP/2, no upgrade handshake, native browser support). Polling would miss sub-second log lines. WebSocket is overkill for single-client. Each long-lived view subscribes to `/api/events` SSE stream filtered by view context. Reconnect with exponential backoff on disconnect.

Event types: `run.created`, `run.updated`, `run.log`, `run.completed`, `run.failed`, `inbox.created`, `lint.completed`.

---

## 6. Settings

URL: `/settings` (modal overlay, not full page, to preserve filter state).

### Project Roots

Table of registered project roots:

| Path | Tags | Default Lane | Actions |
|---|---|---|---|
| `~/Dev Projects/gather-at-the-grove` | #goldberry, #code | Sandcastle | Edit / Remove |
| `~/Dev Projects/agriforestryOS` | #farm, #code | Sandcastle | Edit / Remove |

"+ Add project root" → path picker → tag assignment → default lane selection.

### Vault Path

Single path field. Default: `~/Documents/Dev Projects/vault/`. Change triggers re-index. Warning shown if path does not contain a `CLAUDE.md` file.

### Connector Configuration

Table per connector:

| Connector | Base URL | Auth Status | Enabled |
|---|---|---|---|
| Ghost CMS | `https://goldberrygrove.farm/ghost` | ✅ API key set | ✅ |
| Odoo | `https://erp.goldberrygrove.farm` | ✅ API key set | ✅ |
| farmOS | `https://farm.goldberrygrove.farm` | ✅ OAuth | ✅ |
| Asana | — | ✅ OAuth | ✅ |
| Slack | — | ✅ OAuth | ✅ |
| Buffer | — | ✅ OAuth | ✅ |

Clicking a row opens a connector detail panel: base URL, auth method, re-auth button, test connection button, enable/disable toggle.

### Model Preferences

Per-task-type default tier override. Table mirrors the routing table in Section 7. User can pin a different tier per task type. Individual skill-level pins override these.

### Hermes Daemon Settings

| Field | Default |
|---|---|
| Mode | Local process |
| PID file | `~/.hermes/hermes.pid` |
| API port | `8765` |
| Restart on crash | ✅ |

If running remotely: switch mode to "Remote", enter host/port.

### Sandcastle Defaults

| Field | Default |
|---|---|
| Default Dockerfile | `~/Dev Projects/.sandcastle/Dockerfile.default` |
| Default branch strategy | `branch` |
| Worktree base dir | `~/Dev Projects/.worktrees/` |
| Agent provider | Claude Code |

### Appearance

- Theme: Dark (default). Light mode toggle.
- Accent color: Plum (default). Gold accent option. Custom hex input.
- Font size: Normal / Large.

### Data

- Vault path picker (duplicate of Vault section above, for discoverability).
- Export run history: CSV download of all observability data.
- Clear telemetry: removes all cached run data (not vault content).

---

## 7. Model Routing Strategy

### Task Taxonomy

| Task Type | Description | Example |
|---|---|---|
| `mechanical-bash` | Shell commands, file ops, simple transforms | Move files, rename, archive |
| `structured-extraction` | Parse structured data from text/HTML | Extract dates from email, parse farmOS JSON |
| `summarization` | Condense text, generate short descriptions | Summarize Slack thread, lint report digest |
| `content-drafting` | Write marketing copy, blog posts, social | Ghost CMS post, Buffer caption |
| `code-generation` | Write or modify code with context | Feature implementation, bug fix |
| `planning` | Multi-step workflow design, task breakdown | Sprint planning, video pipeline design |
| `design-judgment` | Ambiguous decisions requiring reasoning | Architecture choice, system refactor |
| `vision` | Analyze images, screenshots | Review design comps, parse farm photos |
| `multi-step-autonomous` | Long-horizon tasks with tool use loops | Hermes Curator, full video pipeline |

### Model Tiers

| Tier | Models | Characteristics |
|---|---|---|
| **Fast** | claude-haiku-4-5, Gemini Flash | Low cost, <1s response, limited reasoning |
| **Balanced** | claude-sonnet-4-6 | Best cost/quality tradeoff, strong code + writing |
| **Reasoning** | claude-opus-4-5 | Deep reasoning, highest cost, slowest |

### Routing Table

| Task Type | Default Tier | Rationale |
|---|---|---|
| `mechanical-bash` | Fast | No reasoning needed; deterministic |
| `structured-extraction` | Fast | Pattern-matching; haiku handles JSON well |
| `summarization` | Fast | Single-pass, low complexity |
| `content-drafting` | Balanced | Requires style and coherence; Sonnet quality sufficient |
| `code-generation` | Balanced | Sonnet is the code workhorse; extended thinking available |
| `planning` | Balanced | Structure + context window; Sonnet handles most |
| `design-judgment` | Reasoning | Ambiguous, high-stakes; Opus for architectural decisions |
| `vision` | Balanced | Sonnet-class vision is adequate for most visual tasks |
| `multi-step-autonomous` | Balanced | Long context loops; Opus only if task explicitly flags high-stakes |

### Override Mechanisms

1. **Skill frontmatter pin** (highest priority): `model: claude-opus-4-5` in skill YAML overrides routing table for all runs of that skill.
2. **Per-run override at dispatch**: Dispatch confirm drawer exposes a "Model" dropdown. Selection applies to that run only.
3. **Global preference in Settings**: Sets default tier per task type (middle priority). Applied when no skill-level pin exists.
4. **Routing table** (lowest priority): Applies when no other override is set.

Resolution order: skill pin → per-run override → global settings → routing table default.

### Cost Guardrails

| Guardrail | Default | Behavior |
|---|---|---|
| Daily spend cap | $5.00 | Blocks all dispatches when reached; shows banner |
| Warn-before-dispatch threshold | $0.50 (estimated run cost) | Shows warning in dispatch drawer; user must confirm |
| Per-tag budget | Unset (configurable) | Same block behavior as daily cap, scoped to tag |

Cost estimates are computed at dispatch time from: model tier × estimated token count (derived from prompt length + task type heuristic). Actual cost captured post-run. Estimates shown with "~" prefix.

### Telemetry Feedback Loop

Every run record in /observability stores:

```
{
  skill_id, task_type, model_used, model_tier,
  input_tokens, output_tokens, cost_actual,
  duration_seconds, status (completed/failed),
  user_satisfaction: null | "good" | "retry_needed"
}
```

"User satisfaction" is captured via a thumbs-up/thumbs-down on completed run cards. Aggregate view in Metrics subview: "Routing quality" table showing success rate and retry rate per task-type × model-tier combination. This data informs manual routing table tuning — no automatic rebalancing in v1.

---

## 8. Mobile Considerations

AgenticOS is desktop-primary. Mobile is read-and-approve only. No responsive layout engineering for editing workflows.

### Must Work on Mobile

| Feature | Implementation |
|---|---|
| /observability run feed | Single-column card stack; all status/cost visible |
| Approve / Cancel pending runs | Large tap targets on run cards |
| Live run strip | Horizontal scroll; auto-collapses when no runs |
| Capture to inbox | Floating "+" button → text input or voice memo upload |
| Global filter chip | Full-screen tag picker modal on mobile tap |
| View tab switching | Bottom tab bar on mobile (replaces header tabs) |

### Deferred for Mobile

- Skill editing (use desktop)
- Settings configuration (use desktop)
- Vault editing (use Obsidian mobile app directly)
- Graph view (too interaction-heavy for touch)
- Lint panel actions (use desktop)
- New skill creation (use desktop)

Voice capture to inbox: user records audio → uploads to `/api/inbox/capture` → Hermes transcribes via Whisper-class model → creates fleeting note in `inbox/`. This is the primary mobile-specific workflow.

---

## 9. ASCII Wireframes

### /architecture View

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ⬡ AgenticOS │ [Architecture] Memory  Observability │ [#farm ×] [+] │ [⌘K] ⚙│
├─────────────────────────────────────────────────────────────────────────────┤
│ All  Farm ●  Software  Marketing  Video  Personal  +new                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ ┌────────────────┐ ┌────────────────┐ ┌────────────────┐ ┌───────────────┐ │
│ │ 🌱             │ │ 📊             │ │ 📹             │ │ 🌿            │ │
│ │ Farm Morning   │ │ Soil Report    │ │ Harvest Reel   │ │ Weekly CSA    │ │
│ │ Brief          │ │ Analysis       │ │ Pipeline       │ │ Newsletter    │ │
│ │                │ │                │ │                │ │               │ │
│ │ Drafts + posts │ │ Pulls farmOS   │ │ Drafts EDL     │ │ Curates week  │ │
│ │ daily Ghost    │ │ sensor data +  │ │ from Obsidian  │ │ from inbox    │ │
│ │ article from   │ │ generates      │ │ sources →      │ │ → Ghost post  │ │
│ │ Obsidian.      │ │ weekly report. │ │ renders video. │ │               │ │
│ │                │ │                │ │                │ │               │ │
│ │ #farm #hermes  │ │ #farm #hermes  │ │ #video #hermes │ │ #farm #market │ │
│ │ 2h ago ✅ 94%  │ │ 6d ago ✅ 100% │ │ 3d ago ✅ 88%  │ │ 7d ago ✅ 91% │ │
│ ├────────────────┤ ├────────────────┤ ├────────────────┤ ├───────────────┤ │
│ │ [▶ Run Now][…] │ │ [▶ Run Now][…] │ │ [▶ Run Now][…] │ │ [▶ Run Now][…]│ │
│ └────────────────┘ └────────────────┘ └────────────────┘ └───────────────┘ │
│                                                                             │
│ ┌────────────────┐ ┌────────────────┐                                       │
│ │ 🐛             │ │ + New Skill    │                                       │
│ │ Fix Auth Bug   │ │                │                                       │
│ │ gather-app     │ │                │                                       │
│ │ #code #sandcst │ │                │                                       │
│ │ 1d ago ❌ 75%  │ │                │                                       │
│ ├────────────────┤ │                │                                       │
│ │ [▶ Run Now][…] │ │                │                                       │
│ └────────────────┘ └────────────────┘                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### /memory View

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ⬡ AgenticOS │ Architecture [Memory] Observability │ [#farm ×] [+] │ [⌘K] ⚙│
├─────────────────────────────────────────────────────────────────────────────┤
│ [🔍 Search wiki pages...                    ]        [◉ Graph]  [⚠ Lint 3] │
├──────────────────┬──────────────────────────────────┬──────────────────────┤
│ WIKI             │                                  │ BACKLINKS            │
│ ───────────      │  # Syntropic Agriculture         │ ──────────           │
│ ▼ Goldberry      │  System at Goldberry Grove       │ ← 4 pages            │
│   ▼ Farm         │                                  │ · Farm Overview      │
│   │ · Syntropic  │  tags: farm, agriforestry        │ · Crop Calendar      │
│   │   Agriculture│  modified: 2026-05-12            │ · Soil Health Log    │
│   │ · Soil Health│                                  │ · Weekly CSA Notes   │
│   │ · Crop Cal.  │  Syntropic agriculture is a      │                      │
│   ▼ Marketing    │  design system that mimics...    │ OUTGOING LINKS       │
│     · Ghost CMS  │                                  │ ──────────────       │
│     · Buffer     │  ## Succession Planting          │ → 6 links            │
│     · Social     │                                  │ · Soil Health        │
│   ▼ Projects     │  Plants are organized into       │ · Crop Calendar      │
│     · gather-app │  functional groups...            │ · farmOS Setup       │
│     · Instnt     │                                  │ · Odoo Integration   │
│ ─────────────    │  ## Current Beds                 │ · Ghost CMS          │
│ INBOX (7)        │                                  │ · Buffer API         │
│ ──────────       │  | Bed | Crop    | Stage |       │                      │
│ ┌──────────────┐ │  |-----|---------|-------|       │ TAGS                 │
│ │ 📝 soil-note │ │  | 1   | Comfrey | Est.  |       │ ──────               │
│ │ "moisture in │ │  | 2   | Banana  | Juv.  |       │ #farm                │
│ │  bed 3 low.."│ │                                  │ #agriforestry        │
│ │[Promote][···]│ │                                  │ #goldberry           │
│ └──────────────┘ │  [Open in Obsidian ↗]            │                      │
│ ┌──────────────┐ │                                  │                      │
│ │ 📝 video-idea│ │                                  │                      │
│ │ "harvest time│ │                                  │                      │
│ │  lapse..."   │ │                                  │                      │
│ │[Promote][···]│ │                                  │                      │
│ └──────────────┘ │                                  │                      │
└──────────────────┴──────────────────────────────────┴──────────────────────┘
```

### /observability View

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ⬡ AgenticOS │ Architecture Memory [Observability] │ [#farm ×] │ [⌘K] ⚙    │
├─────────────────────────────────────────────────────────────────────────────┤
│ LIVE: [🔄 Farm Morning Brief 3m12s ▸] [🏖️ Fix auth bug 1m04s ▸]             │
├──────────────────────────────────────────────┬──────────────────────────────┤
│ RUN FEED                       [All ▾][↓Date]│ METRICS                      │
│ ────────────────────────────────────────────  │ ────────                     │
│ ┌──────────────────────────────────────────┐  │ Today     $0.42  14 runs    │
│ │ 🔄 Farm Morning Brief   #farm  ● RUNNING │  │ Week      $3.18  67 runs    │
│ │    Drafts + publishes daily Ghost post   │  │ Month     $11.4  201 runs   │
│ │    3m 12s · sonnet-4-6 · ~$0.08 · 14k  │  │                              │
│ │    [View Details]           [Cancel]     │  │ [View full metrics →]        │
│ └──────────────────────────────────────────┘  │                              │
│                                               │ SCHEDULE                     │
│ ┌──────────────────────────────────────────┐  │ ────────                     │
│ │ 🏖️ Fix Auth Bug   #code   ● RUNNING      │  │ Farm Brief   07:00  ✅       │
│ │    gather-at-the-grove · branch: fix/.. │  │ Asana Triage 08:00  ✅       │
│ │    1m 04s · sonnet-4-6 · ~$0.12 · 8k   │  │ Curator      Sun    ◌        │
│ │    [View Details]           [Cancel]     │  │ Video Check  Fri    ✅       │
│ └──────────────────────────────────────────┘  │                              │
│                                               │ [Manage schedules →]         │
│ ┌──────────────────────────────────────────┐  │                              │
│ │ ✅ Weekly CSA Newsletter   #farm          │  │                              │
│ │    Curated and published to Ghost        │  │                              │
│ │    4m 12s · haiku-4-5 · $0.03 · 22k    │  │                              │
│ │    [View Details]              👍 👎     │  │                              │
│ └──────────────────────────────────────────┘  │                              │
│                                               │                              │
│ ┌──────────────────────────────────────────┐  │                              │
│ │ ❌ Soil Report Analysis   #farm           │  │                              │
│ │    farmOS API timeout on sensor pull     │  │                              │
│ │    0m 43s · haiku-4-5 · $0.01 · 3k     │  │                              │
│ │    [View Details]  [Retry]               │  │                              │
│ └──────────────────────────────────────────┘  │                              │
└──────────────────────────────────────────────┴──────────────────────────────┘
```

### Run Detail Drawer

```
                         ┌────────────────────────────────────────────────────┐
                         │ ✕  Farm Morning Brief                              │
                         │    🔄 Hermes · #farm #marketing · ● RUNNING       │
                         │    3m 45s · claude-sonnet-4-6 · ~$0.09            │
                         ├────────────────────────────────────────────────────┤
                         │ [Logs] [Timeline] [Usage] [Sandbox]                │
                         ├────────────────────────────────────────────────────┤
                         │                                                    │
                         │ 2026-05-15 07:03:12 Starting Farm Morning Brief   │
                         │ 2026-05-15 07:03:12 Reading Obsidian vault...     │
                         │ 2026-05-15 07:03:14 Found 3 sources from today   │
                         │ 2026-05-15 07:03:14 Calling claude-sonnet-4-6    │
                         │ 2026-05-15 07:03:18 Draft generated (842 words)  │
                         │ 2026-05-15 07:03:18 Calling Ghost CMS API...     │
                         │ 2026-05-15 07:03:19 Post created (draft)         │
                         │ 2026-05-15 07:03:20 Scheduling Buffer post...    │
                         │ ▌ (live)                                           │
                         │                                                    │
                         │                                                    │
                         │                                                    │
                         ├────────────────────────────────────────────────────┤
                         │ [Retry]   [Fork with edits]          [Archive]    │
                         └────────────────────────────────────────────────────┘
```
