"use client";

import { Card, CardAction, CardHead, CardTitle } from "@/components/ui/Card";
import { Row, RowList } from "@/components/ui/Row";
import { useVaultSkills } from "@/lib/vault/hooks/use-vault-skills";

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

export function SkillsCatalogPanel() {
  const { data, isLoading, isError } = useVaultSkills();

  return (
    <Card lane="gold">
      <CardHead>
        <CardTitle icon={BookIcon}>Skills catalog</CardTitle>
        <CardAction>
          {data ? `${data.totalRegistered} registered` : "—"}
        </CardAction>
      </CardHead>
      {isLoading ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          Loading…
        </div>
      ) : isError || !data ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          Skills catalog unavailable.
        </div>
      ) : data.skills.length === 0 ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          No skills registered.
        </div>
      ) : (
        <RowList>
          {data.skills.map((s) => (
            <Row
              key={s.path}
              style={{ gridTemplateColumns: "1fr", gap: 4 }}
            >
              <div>
                <div className="label-strong" style={{ fontSize: 12.5 }}>
                  {s.name}
                </div>
                {s.description && (
                  <div
                    className="meta"
                    style={{ fontSize: 11, color: "var(--parchment-muted)" }}
                  >
                    {s.description}
                  </div>
                )}
                {s.usedBy.length > 0 && (
                  <div
                    className="meta"
                    style={{ fontFamily: "var(--mono)", fontSize: 10.5 }}
                  >
                    used by {s.usedBy.join(" · ")}
                  </div>
                )}
              </div>
            </Row>
          ))}
        </RowList>
      )}
    </Card>
  );
}
