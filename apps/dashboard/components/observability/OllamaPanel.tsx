"use client";
import { useQuery } from "@tanstack/react-query";

import { Card, CardAction, CardHead, CardTitle } from "@/components/ui/Card";
import { Row, RowList } from "@/components/ui/Row";

interface OllamaModelUsage {
  name: string;
  role: string;
  size: string;
  age: string;
  calls_today: number;
}

interface OllamaData {
  endpoint: string;
  models: OllamaModelUsage[];
}

const ChipIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 9h6v6H9z" />
    <path d="M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2" />
  </svg>
);

function useOllama() {
  return useQuery<OllamaData>({
    queryKey: ["cost", "models", "ollama"],
    queryFn: async () => {
      const res = await fetch("/api/cost/models/ollama");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 60_000,
  });
}

export function OllamaPanel() {
  const { data, isLoading } = useOllama();

  return (
    <Card lane="pine">
      <CardHead>
        <CardTitle icon={ChipIcon}>Ollama · local</CardTitle>
        <CardAction>{data?.endpoint ?? "localhost:11434"}</CardAction>
      </CardHead>
      {isLoading || !data ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          Loading…
        </div>
      ) : (
        <RowList>
          {data.models.map((m) => (
            <Row
              key={m.name}
              style={{ gridTemplateColumns: "1fr auto", gap: 0 }}
            >
              <div>
                <div className="label-strong">{m.name}</div>
                <div
                  className="meta"
                  style={{ fontFamily: "var(--mono)", fontSize: 10.5 }}
                >
                  {m.role} · {m.size} · {m.age}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="num" style={{ fontSize: 14 }}>
                  {m.calls_today.toLocaleString()}
                </div>
                <div
                  className="meta"
                  style={{ fontFamily: "var(--mono)", fontSize: 10.5 }}
                >
                  calls today
                </div>
              </div>
            </Row>
          ))}
        </RowList>
      )}
    </Card>
  );
}
