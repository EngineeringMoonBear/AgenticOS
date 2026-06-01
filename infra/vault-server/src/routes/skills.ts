import type { FastifyInstance } from "fastify";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Config } from "../config.js";

interface SkillEntry {
  name: string;
  description: string;
  triggers: string[];
  usedBy: string[];
  path: string;
}

const SKILL_REGEX = /^---\s*\n([\s\S]*?)\n---/;

/**
 * GET /skills — lists skill pages from the Obsidian vault's `wiki/Skills/`
 * directory (mirrored from ~/.claude/skills). Real skill pages frequently omit
 * `triggers`/`used_by`, so those default to []. Returns an empty list (not an
 * error) when the directory is missing, so the dashboard panel degrades cleanly.
 */
export function registerSkillsRoute(app: FastifyInstance, config: Config): void {
  app.get("/skills", async () => {
    const wikiSubdir = config.wikiSubdir ?? "wiki";
    const relDir = path.posix.join(wikiSubdir, "Skills");
    const skillsRoot = path.join(config.vaultRoot, wikiSubdir, "Skills");
    let entries: string[];
    try {
      entries = await fs.readdir(skillsRoot);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { totalRegistered: 0, skills: [] };
      }
      throw err;
    }

    const skills: SkillEntry[] = [];
    for (const name of entries) {
      if (!name.endsWith(".md")) continue;
      const full = path.join(skillsRoot, name);
      const raw = await fs.readFile(full, "utf-8");
      const fm = parseFrontmatter(raw);
      if (!fm) continue;
      skills.push({
        name: (fm.name as string) ?? name.replace(/\.md$/, ""),
        description: (fm.description as string) ?? "",
        triggers: toStringArray(fm.triggers),
        usedBy: toStringArray(fm.used_by ?? fm.usedBy),
        path: path.posix.join(relDir, name),
      });
    }

    return { totalRegistered: skills.length, skills };
  });
}

function parseFrontmatter(raw: string): Record<string, unknown> | null {
  const match = SKILL_REGEX.exec(raw);
  if (!match) return null;
  const fm: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      fm[key] = val
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      fm[key] = val;
    }
  }
  return fm;
}

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v) return [v];
  return [];
}
