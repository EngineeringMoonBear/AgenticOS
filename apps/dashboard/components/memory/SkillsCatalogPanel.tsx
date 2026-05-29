"use client";
import { useQuery } from "@tanstack/react-query";

import { Card, CardAction, CardHead, CardTitle } from "@/components/ui/Card";
import { Row, RowList } from "@/components/ui/Row";

interface SkillEntry {
  name: string;
  used_by: string;
  invocations: number;
}

interface SkillsCatalogData {
  total_registered: number;
  skills: SkillEntry[];
}

const BookIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    <line x1="8" y1="7" x2="16" y2="7" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </svg>
);

function useSkillsCatalog() {
  return useQuery<SkillsCatalogData>({
    queryKey: ["memory", "skills"],
    queryFn: async () => {
      const res = await fetch("/api/memory/skills");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 5 * 60_000,
  });
}

export function SkillsCatalogPanel() {
  const { data, isLoading } = useSkillsCatalog();

  return (
    <Card lane="gold">
      <CardHead>
        <CardTitle icon={BookIcon}>Skills catalog</CardTitle>
        <CardAction>
          {data ? `${data.total_registered} registered` : "—"}
        </CardAction>
      </CardHead>
      {isLoading || !data ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          Loading…
        </div>
      ) : (
        <RowList>
          {data.skills.map((s) => (
            <Row
              key={s.name}
              style={{ gridTemplateColumns: "1fr auto", gap: 8 }}
            >
              <div>
                <div className="label-strong" style={{ fontSize: 12.5 }}>
                  {s.name}
                </div>
                <div
                  className="meta"
                  style={{ fontFamily: "var(--mono)", fontSize: 10.5 }}
                >
                  {s.used_by}
                </div>
              </div>
              <span className="num" style={{ fontSize: 13 }}>
                {s.invocations}
              </span>
            </Row>
          ))}
        </RowList>
      )}
    </Card>
  );
}
