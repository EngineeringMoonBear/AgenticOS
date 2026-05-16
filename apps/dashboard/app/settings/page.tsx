export default function SettingsPage() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-2 px-6 py-12">
      <h1
        className="text-2xl font-medium tracking-tight"
        style={{ color: "var(--text)" }}
      >
        Settings
      </h1>
      <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
        Coming in Task 7 — project roots, vault config, and appearance.
      </p>
    </div>
  );
}
