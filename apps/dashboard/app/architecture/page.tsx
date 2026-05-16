"use client";

import { Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useFilter } from "@/lib/filter/use-filter";
import { SKILL_FIXTURES } from "@/lib/fixtures/skills";
import { SkillCard } from "@/components/skills/skill-card";

const DOMAIN_CHIPS: { id: string; label: string }[] = [
  { id: "farm", label: "Farm" },
  { id: "software", label: "Software" },
  { id: "marketing", label: "Marketing" },
  { id: "video", label: "Video" },
  { id: "personal", label: "Personal" },
];

export default function ArchitecturePage() {
  const { tags, toggleTag, clear } = useFilter();

  const visibleSkills =
    tags.length === 0
      ? SKILL_FIXTURES
      : SKILL_FIXTURES.filter((skill) =>
          skill.tags.some((t) => tags.includes(t))
        );

  function handleNewSkill() {
    toast.info("Skill creation available in Phase 2.");
  }

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1
            className="text-xl font-medium tracking-tight"
            style={{ color: "var(--text)" }}
          >
            Architecture
          </h1>
          <p
            className="mt-0.5 text-sm"
            style={{ color: "var(--text-secondary)" }}
          >
            Buttonize your workflows.
          </p>
        </div>

        {/* + New Skill */}
        <button
          type="button"
          onClick={handleNewSkill}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
          style={{
            backgroundColor: "var(--surface-muted)",
            border: "1px solid var(--border)",
            color: "var(--text-secondary)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor =
              "var(--border-strong)";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--text)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor =
              "var(--border)";
            (e.currentTarget as HTMLButtonElement).style.color =
              "var(--text-secondary)";
          }}
          aria-label="Create new skill"
        >
          <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
          New Skill
        </button>
      </div>

      {/* Domain rail */}
      <div
        className="flex items-center gap-2 overflow-x-auto pb-1"
        role="group"
        aria-label="Filter by domain"
      >
        {/* All chip */}
        <button
          type="button"
          onClick={clear}
          className="flex shrink-0 items-center rounded px-3 py-1 text-xs font-medium transition-colors"
          style={{
            height: 26,
            backgroundColor:
              tags.length === 0 ? "var(--accent-plum-800)" : "var(--surface-muted)",
            color:
              tags.length === 0
                ? "var(--accent-plum-300)"
                : "var(--text-secondary)",
            border: `1px solid ${tags.length === 0 ? "var(--accent-plum-600)" : "var(--border-subtle)"}`,
          }}
          aria-pressed={tags.length === 0}
        >
          All
        </button>

        {DOMAIN_CHIPS.map(({ id, label }) => {
          const isActive = tags.includes(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => toggleTag(id)}
              className="flex shrink-0 items-center rounded px-3 py-1 text-xs font-medium transition-colors"
              style={{
                height: 26,
                backgroundColor: isActive
                  ? "var(--accent-plum-800)"
                  : "var(--surface-muted)",
                color: isActive
                  ? "var(--accent-plum-300)"
                  : "var(--text-secondary)",
                border: `1px solid ${isActive ? "var(--accent-plum-600)" : "var(--border-subtle)"}`,
              }}
              aria-pressed={isActive}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Skill grid or empty state */}
      {visibleSkills.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20">
          <Sparkles
            size={40}
            strokeWidth={1.5}
            style={{ color: "var(--text-muted)" }}
            aria-hidden="true"
          />
          <p
            className="text-sm font-medium"
            style={{ color: "var(--text-secondary)" }}
          >
            No skills match this filter
          </p>
          <button
            type="button"
            onClick={clear}
            className="text-sm underline underline-offset-4 transition-colors"
            style={{ color: "var(--accent-plum-400)" }}
          >
            Clear filter
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleSkills.map((skill) => (
            <SkillCard key={skill.id} skill={skill} />
          ))}
        </div>
      )}
    </div>
  );
}
