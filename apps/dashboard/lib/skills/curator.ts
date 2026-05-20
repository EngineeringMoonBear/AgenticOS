import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SkillDefinition } from "./types";

const SYSTEM_PROMPT = readFileSync(
  path.join(process.cwd(), "lib/skills/prompts/curator-system.txt"),
  "utf-8",
);

export const curator: SkillDefinition = {
  id:           "curator",
  name:         "Vault Curator",
  description:  "Nightly: promotes inbox items > 7 days old; runs lint; writes curator-log.md.",
  budget:       1.0,
  toolNames: [
    "vault.page.read",
    "vault.tree.list",
    "vault.search",
    "vault.backlinks",
    "vault.inbox.list",
    "vault.inbox.item",
    "vault.inbox.commit",
    "vault.inbox.discard",
    "lint.run",
  ],
  systemPrompt: SYSTEM_PROMPT,
  userPrompt: (ctx) =>
    `Today's date: ${ctx.todayIso}\n` +
    `Last curator run: ${ctx.lastRunIso}\n` +
    `Budget cap: $${ctx.budget}\n\n` +
    `Begin the curator workflow now.`,
  stalenessThresholdMs: 300_000,
};
