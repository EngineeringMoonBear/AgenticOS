import "server-only";
import type { SkillDefinition } from "./types";
import { curator } from "./curator";

const REGISTRY: Record<string, SkillDefinition> = {
  curator,
};

export async function resolveSkill(id: string): Promise<SkillDefinition> {
  const skill = REGISTRY[id];
  if (!skill) throw new Error(`Skill not registered: ${id}`);
  return skill;
}

export function listSkills(): SkillDefinition[] {
  return Object.values(REGISTRY);
}
