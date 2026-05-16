import { readConfig } from "@/lib/config/config-io";
import { DEFAULT_CONFIG } from "@/lib/config/schema";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { SlidersHorizontal } from "lucide-react";

export const metadata = {
  title: "Settings — AgenticOS",
};

export default async function SettingsPage() {
  let initialConfig = DEFAULT_CONFIG;
  let configError: string | null = null;

  try {
    initialConfig = await readConfig();
  } catch (err: unknown) {
    configError =
      err instanceof Error
        ? err.message
        : "Failed to load settings. Using defaults.";
  }

  return (
    <div className="px-6 py-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-8">
        <SlidersHorizontal size={20} style={{ color: "var(--text-muted)" }} />
        <h1
          className="text-xl font-medium"
          style={{ color: "var(--text)" }}
        >
          Settings
        </h1>
      </div>

      {configError && (
        <div
          className="mb-6 p-4 rounded-lg border text-sm"
          style={{
            backgroundColor: "var(--error-bg)",
            borderColor: "var(--error-border)",
            color: "var(--error)",
          }}
          role="alert"
        >
          <strong>Config file error:</strong> {configError}
        </div>
      )}

      <SettingsForm initialConfig={initialConfig} />
    </div>
  );
}
