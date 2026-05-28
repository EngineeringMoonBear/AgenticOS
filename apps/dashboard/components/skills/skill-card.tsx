"use client";

import { Send, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import type { Skill } from "@/lib/fixtures/skills";

interface SkillCardProps {
  skill: Skill;
}

function formatLastRun(isoDate: string): string {
  const now = new Date();
  const then = new Date(isoDate);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "1 day ago";
  return `${diffDays} days ago`;
}

export function SkillCard({ skill }: SkillCardProps) {
  function handleDispatch() {
    toast.info("Dispatching wires up in Phase 4.", {
      description: skill.name,
    });
  }

  return (
    <GlassCard
      role="article"
      className="group/card flex flex-col p-0 transition-colors hover:bg-white/[0.09] hover:border-white/20"
      style={{ minHeight: 160 }}
    >
      {/* Card body */}
      <div className="flex flex-col gap-3 p-4 flex-1">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <h3
            className="text-sm font-medium leading-snug"
            style={{ color: "var(--text)" }}
          >
            {skill.name}
          </h3>
          {/* Kebab — visible on hover */}
          <button
            type="button"
            aria-label="More options"
            className="shrink-0 rounded-md p-0.5 transition-opacity opacity-0 group-hover/card:opacity-100"
            style={{ color: "var(--text-muted)" }}
          >
            <MoreHorizontal size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        {/* Description */}
        <p
          className="text-xs leading-relaxed line-clamp-2"
          style={{ color: "var(--text-secondary)" }}
        >
          {skill.description}
        </p>

        {/* Tag chips */}
        <div className="flex flex-wrap gap-1.5">
          {skill.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex h-[22px] items-center rounded px-2 text-[11px] font-medium"
              style={{
                backgroundColor: "var(--surface-muted)",
                color: "var(--text-muted)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              #{tag}
            </span>
          ))}
        </div>

        {/* Meta row */}
        <p
          className="text-[11px] mt-auto"
          style={{ color: "var(--text-muted)" }}
        >
          Last run: {formatLastRun(skill.lastRunAt)} &middot; {skill.successRate}% success
        </p>
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        {/* Lane badge */}
        <span
          className="text-[10px] font-medium uppercase tracking-wider"
          style={{
            color:
              skill.lane === "hermes"
                ? "var(--lane-hermes)"
                : "var(--lane-sandcastle)",
          }}
        >
          {skill.lane}
        </span>

        {/* Dispatch button — disabled, tooltip via title */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleDispatch}
          title="Dispatching wires up in Phase 4"
          aria-label={`Dispatch ${skill.name}`}
          className="flex items-center gap-1.5 text-xs"
          style={{
            borderColor: "var(--accent-gold-400)",
            color: "var(--accent-gold-400)",
            height: 28,
          }}
        >
          <Send size={12} strokeWidth={1.5} aria-hidden="true" />
          Dispatch
        </Button>
      </div>
    </GlassCard>
  );
}
