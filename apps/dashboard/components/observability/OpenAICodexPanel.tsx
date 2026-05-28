"use client";
import { useQuery } from "@tanstack/react-query";

import { Card, CardAction, CardHead, CardTitle } from "@/components/ui/Card";
import { Row, RowList } from "@/components/ui/Row";

interface OpenAIModelUsage {
  name: string;
  role: string;
  calls: number;
  age: string;
  spend_usd: number;
}

interface OpenAICodexData {
  endpoint: string;
  models: OpenAIModelUsage[];
}

const OctaIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 2 L20 7 V17 L12 22 L4 17 V7 Z" />
    <path d="M12 2 V22 M4 7 L20 17 M20 7 L4 17" />
  </svg>
);

function useOpenAICodex() {
  return useQuery<OpenAICodexData>({
    queryKey: ["cost", "models", "openai"],
    queryFn: async () => {
      const res = await fetch("/api/cost/models/openai");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 60_000,
  });
}

export function OpenAICodexPanel() {
  const { data, isLoading } = useOpenAICodex();

  return (
    <Card lane="gold">
      <CardHead>
        <CardTitle icon={OctaIcon}>OpenAI Codex · cloud</CardTitle>
        <CardAction>{data?.endpoint ?? "api.openai.com"}</CardAction>
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
                  {m.role} · {m.calls} calls · {m.age}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div
                  className="num"
                  style={{ fontSize: 14, color: "var(--gold-bright)" }}
                >
                  ${m.spend_usd.toFixed(2)}
                </div>
                <div
                  className="meta"
                  style={{ fontFamily: "var(--mono)", fontSize: 10.5 }}
                >
                  today
                </div>
              </div>
            </Row>
          ))}
        </RowList>
      )}
    </Card>
  );
}
