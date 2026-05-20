// Stub awaiting Task 5 (Curator skill implementation). Do not delete.
// Task 5 will replace this stub with concrete skill definitions.

export interface SkillUserPromptParams {
  todayIso:   string;
  lastRunIso: string;
  budget:     number;
}

export interface SkillDefinition {
  id:           string;
  model?:       string;
  budget?:      number;
  toolNames?:   string[];
  systemPrompt: string;
  userPrompt:   (params: SkillUserPromptParams) => string;
}
