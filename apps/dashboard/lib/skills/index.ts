// Stub awaiting Task 5 (Curator skill implementation). Do not delete.
// Task 5 will fill this in with real skill registry logic.
import "server-only";
import type { SkillDefinition } from "./types";

export type { SkillDefinition };

export async function resolveSkill(id: string): Promise<SkillDefinition> {
  throw new Error(`Skill registry not yet implemented (Phase 3 Task 5): ${id}`);
}

export function listSkills(): SkillDefinition[] {
  return [];
}
