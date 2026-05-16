/**
 * Phase 1 wiki fixtures — no real vault reads.
 * Data shape designed to be replaced by API calls in Phase 2.
 *
 * path: relative to wiki/ root, using forward slashes, matching Obsidian file paths.
 * backlinks: array of paths linking TO this page.
 * outgoing: array of paths this page links TO (parsed from [[wikilinks]]).
 */

export interface WikiPage {
  id: string;
  /** Relative path under wiki/ e.g. "Farm/Syntropic Plot A12" */
  path: string;
  title: string;
  tags: string[];
  /** Short markdown body with at least 2 [[wikilinks]] */
  body: string;
  /** Paths of other pages that link to this page */
  backlinks: string[];
  /** Paths this page links out to */
  outgoing: string[];
}

export interface InboxNote {
  id: string;
  title: string;
  snippet: string;
  capturedAt: string;
  tags: string[];
}

export const WIKI_PAGES: WikiPage[] = [
  // ── Concepts ──────────────────────────────────────────────────────
  {
    id: "concepts-syntropic-agriculture",
    path: "Concepts/Syntropic Agriculture",
    title: "Syntropic Agriculture",
    tags: ["farm", "agriforestry", "concepts"],
    body: `# Syntropic Agriculture

Syntropic agriculture is a design system for food production that mimics natural succession — moving from pioneer species through secondary growth to climax ecosystems.

## Core Principles

- **Succession planting** — each functional layer accelerates the maturity of the next.
- **Chop-and-drop** — biomass is cycled in place rather than exported.
- **No external inputs** — fertility builds from within the system.

## At Goldberry Grove

Our implementation draws heavily on [[Farm/Syntropic Plot A12]] and the soil restoration work documented in [[Farm/Soil Health Log]].

The goal is a fully closed-loop system by 2030. See [[Concepts/Permaculture Ethics]] for the value framework.
`,
    backlinks: ["Farm/Syntropic Plot A12", "Concepts/Permaculture Ethics"],
    outgoing: ["Farm/Syntropic Plot A12", "Farm/Soil Health Log", "Concepts/Permaculture Ethics"],
  },
  {
    id: "concepts-permaculture-ethics",
    path: "Concepts/Permaculture Ethics",
    title: "Permaculture Ethics",
    tags: ["concepts", "personal", "agriforestry"],
    body: `# Permaculture Ethics

The three ethics of permaculture provide the moral foundation for all design decisions:

1. **Earth Care** — care for all living and non-living things.
2. **People Care** — care for self, community, and future generations.
3. **Fair Share** — return surplus to the system.

## Application at Goldberry Grove

Every design choice — from [[Concepts/Syntropic Agriculture]] to [[Farm/Crop Calendar]] — is evaluated against these three ethics.

The CSA model operationalises People Care: community members share in abundance and risk alike.
`,
    backlinks: ["Concepts/Syntropic Agriculture", "Farm/Crop Calendar"],
    outgoing: ["Concepts/Syntropic Agriculture", "Farm/Crop Calendar"],
  },

  // ── Farm ──────────────────────────────────────────────────────────
  {
    id: "farm-syntropic-plot-a12",
    path: "Farm/Syntropic Plot A12",
    title: "Syntropic Plot A12",
    tags: ["farm", "agriforestry"],
    body: `# Syntropic Plot A12

Plot A12 is the primary demonstration bed for [[Concepts/Syntropic Agriculture]] at Goldberry Grove.

## Current Plantings

| Bed | Crop | Stage |
|-----|------|-------|
| 1 | Comfrey (pioneer) | Established |
| 2 | Banana (secondary) | Juvenile |
| 3 | Cacao (climax) | Seedling |

## Soil Status

Latest readings in [[Farm/Soil Health Log]] show pH 6.4 and strong fungal networks.

Irrigation schedule synced with [[Farm/Crop Calendar]].
`,
    backlinks: ["Concepts/Syntropic Agriculture", "Farm/Soil Health Log", "Farm/Crop Calendar"],
    outgoing: ["Concepts/Syntropic Agriculture", "Farm/Soil Health Log", "Farm/Crop Calendar"],
  },
  {
    id: "farm-soil-health-log",
    path: "Farm/Soil Health Log",
    title: "Soil Health Log",
    tags: ["farm", "data"],
    body: `# Soil Health Log

Ongoing monitoring of soil biology and chemistry across all growing zones.

## Latest Readings — 2026-05-10

| Zone | pH | Organic Matter | Brix | Notes |
|------|----|---------------|------|-------|
| A12 | 6.4 | 7.2% | 14 | Strong mycelium |
| B3 | 5.9 | 4.1% | 11 | Needs lime |

## Reference Pages

Interpretation framework: [[Concepts/Syntropic Agriculture]].
Water retention plan: [[Farm/Crop Calendar]].
Integration with farmOS documented in [[Software/farmOS Setup]].
`,
    backlinks: ["Farm/Syntropic Plot A12", "Concepts/Syntropic Agriculture"],
    outgoing: ["Concepts/Syntropic Agriculture", "Farm/Crop Calendar", "Software/farmOS Setup"],
  },
  {
    id: "farm-crop-calendar",
    path: "Farm/Crop Calendar",
    title: "Crop Calendar",
    tags: ["farm", "planning"],
    body: `# Crop Calendar 2026

Succession planting schedule for Goldberry Grove, aligned with [[Concepts/Syntropic Agriculture]] principles.

## Q2 2026

- **April**: Direct sow comfrey pioneers in A12, B3, C1.
- **May**: Transplant banana suckers — see [[Farm/Syntropic Plot A12]].
- **June**: Begin cacao nursery batch.

## Irrigation Windows

Drip system runs 05:30–06:30 daily. Override via farmOS — integration notes in [[Software/farmOS Setup]].
`,
    backlinks: ["Concepts/Permaculture Ethics", "Farm/Syntropic Plot A12", "Farm/Soil Health Log"],
    outgoing: ["Concepts/Syntropic Agriculture", "Farm/Syntropic Plot A12", "Software/farmOS Setup"],
  },

  // ── Marketing ─────────────────────────────────────────────────────
  {
    id: "marketing-ghost-cms",
    path: "Marketing/Ghost CMS",
    title: "Ghost CMS",
    tags: ["marketing", "software"],
    body: `# Ghost CMS

Goldberry Grove's primary publishing platform, hosted at goldberrygrove.farm.

## Key Integrations

- **Buffer** — social scheduling via [[Marketing/Buffer Strategy]].
- **Obsidian** — posts drafted from wiki sources; workflow in [[Marketing/Content Workflow]].
- **AgenticOS** — Farm Morning Brief skill auto-publishes daily posts.

## API Notes

Admin API key stored in 1Password under "Ghost CMS — goldberrygrove". Rate limits: 300 req/min.
`,
    backlinks: ["Marketing/Buffer Strategy", "Marketing/Content Workflow"],
    outgoing: ["Marketing/Buffer Strategy", "Marketing/Content Workflow"],
  },
  {
    id: "marketing-buffer-strategy",
    path: "Marketing/Buffer Strategy",
    title: "Buffer Strategy",
    tags: ["marketing", "social"],
    body: `# Buffer Strategy

Social scheduling strategy across Instagram, Facebook, and LinkedIn for Goldberry Grove.

## Channels

| Platform | Cadence | Best Time |
|----------|---------|-----------|
| Instagram | 4×/week | 07:00, 17:00 |
| Facebook | 2×/week | 09:00 |
| LinkedIn | 1×/week | Tue 08:00 |

## Content Pipeline

Posts sourced from [[Marketing/Ghost CMS]] via AgenticOS daily brief skill. Visual assets managed in Canva.

Hashtag research and performance tracking notes: [[Marketing/Content Workflow]].
`,
    backlinks: ["Marketing/Ghost CMS", "Marketing/Content Workflow"],
    outgoing: ["Marketing/Ghost CMS", "Marketing/Content Workflow"],
  },
  {
    id: "marketing-content-workflow",
    path: "Marketing/Content Workflow",
    title: "Content Workflow",
    tags: ["marketing", "instnt", "workflow"],
    body: `# Content Workflow

End-to-end process for producing and publishing Goldberry Grove content.

## Pipeline

1. Capture ideas → Obsidian inbox
2. Draft in Obsidian wiki → link to [[Farm/Syntropic Plot A12]] and related pages
3. Review → promote to [[Marketing/Ghost CMS]] draft
4. Schedule social via [[Marketing/Buffer Strategy]]

## Instnt Integration

Customer messages and inquiries flow through Instnt. Content strategy informed by recurring question threads.

Responses drafted with AgenticOS skill "CSA Inquiry Reply".
`,
    backlinks: ["Marketing/Ghost CMS", "Marketing/Buffer Strategy"],
    outgoing: ["Farm/Syntropic Plot A12", "Marketing/Ghost CMS", "Marketing/Buffer Strategy"],
  },

  // ── Software ──────────────────────────────────────────────────────
  {
    id: "software-farmos-setup",
    path: "Software/farmOS Setup",
    title: "farmOS Setup",
    tags: ["software", "farm", "data"],
    body: `# farmOS Setup

Self-hosted farmOS instance at farm.goldberrygrove.farm. Tracks field activities, logs, and sensor data.

## Integrations

- **Soil monitoring** — readings pushed automatically to [[Farm/Soil Health Log]].
- **AgenticOS** — Soil Report Analysis skill pulls JSON from farmOS API.
- **Odoo** — inventory sync documented in [[Software/Odoo Integration]].

## API Auth

OAuth2 client credentials stored in AgenticOS Settings → Connectors.
`,
    backlinks: ["Farm/Soil Health Log", "Farm/Crop Calendar"],
    outgoing: ["Farm/Soil Health Log", "Software/Odoo Integration"],
  },
  {
    id: "software-odoo-integration",
    path: "Software/Odoo Integration",
    title: "Odoo Integration",
    tags: ["software", "instnt"],
    body: `# Odoo Integration

Odoo ERP at erp.goldberrygrove.farm. Used for inventory, invoicing, and CSA subscription management.

## Synced Data

| Module | Direction | Frequency |
|--------|-----------|-----------|
| Inventory | farmOS → Odoo | Daily |
| Invoices | Odoo → Ghost | On publish |
| Members | Odoo → Instnt | Real-time |

## References

farmOS integration details: [[Software/farmOS Setup]].
CSA content workflow: [[Marketing/Content Workflow]].
`,
    backlinks: ["Software/farmOS Setup"],
    outgoing: ["Software/farmOS Setup", "Marketing/Content Workflow"],
  },

  // ── Video ─────────────────────────────────────────────────────────
  {
    id: "video-harvest-reel-pipeline",
    path: "Video/Harvest Reel Pipeline",
    title: "Harvest Reel Pipeline",
    tags: ["video", "marketing"],
    body: `# Harvest Reel Pipeline

Process for producing short-form harvest documentary content for social media.

## Workflow

1. **Capture** — GoPro Hero 12 during harvest days (see [[Farm/Crop Calendar]] for schedule).
2. **Ingest** — footage tagged by bed and crop in DaVinci Resolve.
3. **Edit** — AgenticOS Video Pipeline skill drafts EDL from Obsidian sources.
4. **Publish** — final renders pushed to [[Marketing/Buffer Strategy]] queue.

## Style Guide

Warm tones, natural sound design. No voiceover — text overlays only in brand font (Inter).
`,
    backlinks: ["Marketing/Buffer Strategy"],
    outgoing: ["Farm/Crop Calendar", "Marketing/Buffer Strategy"],
  },
  {
    id: "video-equipment-log",
    path: "Video/Equipment Log",
    title: "Equipment Log",
    tags: ["video", "personal"],
    body: `# Equipment Log

Camera and audio equipment inventory for Goldberry Grove video production.

## Current Kit

| Item | Status | Notes |
|------|--------|-------|
| GoPro Hero 12 | Active | Harvest Reel shoots |
| DJI Mic 2 | Active | Voice-over recording |
| DaVinci Resolve Studio | Licensed | Main NLE |

## Maintenance Schedule

Firmware updates logged here. Calibration against [[Video/Harvest Reel Pipeline]] style targets.

Memory cards formatted after each transfer — checklist in personal tasks.
`,
    backlinks: ["Video/Harvest Reel Pipeline"],
    outgoing: ["Video/Harvest Reel Pipeline"],
  },
];

/** Folders derived from the fixture pages */
export const WIKI_FOLDERS = ["Concepts", "Farm", "Marketing", "Software", "Video"] as const;
export type WikiFolder = (typeof WIKI_FOLDERS)[number];

/** Group pages by their top-level folder */
export function groupPagesByFolder(pages: WikiPage[]): Record<string, WikiPage[]> {
  const groups: Record<string, WikiPage[]> = {};
  for (const folder of WIKI_FOLDERS) {
    groups[folder] = [];
  }
  for (const page of pages) {
    const folder = page.path.split("/")[0];
    if (folder && groups[folder]) {
      groups[folder].push(page);
    }
  }
  return groups;
}

/** Resolve a path string to a WikiPage (or undefined) */
export function getPageByPath(path: string): WikiPage | undefined {
  return WIKI_PAGES.find((p) => p.path === path);
}

/** Inbox fixture notes */
export const INBOX_NOTES: InboxNote[] = [
  {
    id: "inbox-2026-05-16-0834",
    title: "2026-05-16-0834",
    snippet: "Need to check soil moisture sensor in bed 3 — readings seem low. May need recalibration or the drip line is blocked.",
    capturedAt: "2026-05-16T08:34:00Z",
    tags: ["farm"],
  },
  {
    id: "inbox-2026-05-15-1712",
    title: "2026-05-15-1712",
    snippet: "Harvest time-lapse idea — set up GoPro on tripod at east end of plot A12, sunrise to sunset on a Wednesday.",
    capturedAt: "2026-05-15T17:12:00Z",
    tags: ["video", "farm"],
  },
  {
    id: "inbox-2026-05-14-0921",
    title: "2026-05-14-0921",
    snippet: "Buffer post performed really well this week — 4.2% engagement on the banana sucker video. Should do a full series.",
    capturedAt: "2026-05-14T09:21:00Z",
    tags: ["marketing", "social"],
  },
];
