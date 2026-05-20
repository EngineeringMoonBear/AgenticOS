export interface SkillDefinition {
  id:                    string;
  name:                  string;
  description:           string;
  model?:                string;
  budget?:               number;
  toolNames:             string[];
  systemPrompt:          string;
  userPrompt(ctx:        { todayIso: string; lastRunIso: string; budget: number }): string;
  stalenessThresholdMs:  number;
}
