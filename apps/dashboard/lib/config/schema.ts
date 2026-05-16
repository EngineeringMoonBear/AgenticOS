import { z } from "zod";

export const ProjectRootSchema = z.object({
  path: z.string(),
  tags: z.array(z.string()),
});

export const ModelPreferenceSchema = z.object({
  tier: z.enum(["haiku", "sonnet", "opus"]),
  default: z.string(),
});

export const ConnectorConfigSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
});

export const AgenticOSConfigSchema = z.object({
  projectRoots: z.array(ProjectRootSchema),
  vaultPath: z.string(),
  modelDefaults: z.object({
    haiku: z.string(),
    sonnet: z.string(),
    opus: z.string(),
  }),
  connectors: z.array(ConnectorConfigSchema),
});

export type ProjectRoot = z.infer<typeof ProjectRootSchema>;
export type ModelPreference = z.infer<typeof ModelPreferenceSchema>;
export type ConnectorConfig = z.infer<typeof ConnectorConfigSchema>;
export type AgenticOSConfig = z.infer<typeof AgenticOSConfigSchema>;

export const DEFAULT_CONNECTORS: ConnectorConfig[] = [
  { id: "farmos", enabled: false },
  { id: "odoo", enabled: false },
  { id: "ghost", enabled: false },
  { id: "asana", enabled: false },
  { id: "slack", enabled: false },
  { id: "gh", enabled: false },
];

export const DEFAULT_CONFIG: AgenticOSConfig = {
  projectRoots: [],
  vaultPath: "~/Documents/Dev Projects/vault",
  modelDefaults: {
    haiku: "claude-haiku-4-5",
    sonnet: "claude-sonnet-4-7",
    opus: "claude-opus-4-7",
  },
  connectors: DEFAULT_CONNECTORS,
};
